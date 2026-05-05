import { useState, useEffect, useRef, useCallback } from 'react'
import { getUsers, claimUser, getHistory } from './api.js'
import { connect, disconnect, sendMessage, sendTyping } from './chatSocket.js'
import './App.css'

const USER_COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981',
  '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6',
]

function getUserColor(uid, users) {
  const idx = users.findIndex((u) => u.id === uid)
  return USER_COLORS[idx >= 0 ? idx % USER_COLORS.length : 0]
}

function getInitials(uid) {
  return uid.replace(/[a-z]+/i, '').slice(0, 2) || uid.slice(0, 2).toUpperCase()
}

function formatTime(createdAt) {
  if (!createdAt) return ''
  return new Date(createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

// Highlight @mention trong nội dung tin nhắn
function renderContent(text) {
  return text.split(/(@\w+)/g).map((part, i) =>
    /^@\w+$/.test(part)
      ? <span key={i} className="mention">{part}</span>
      : part
  )
}

function Avatar({ uid, users, size = 32 }) {
  const color = getUserColor(uid, users)
  return (
    <div
      className="avatar"
      style={{ background: color, width: size, height: size, fontSize: size * 0.38 }}
    >
      {getInitials(uid)}
    </div>
  )
}

function Toast({ text, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <div className={`toast toast-${type}`} onClick={onClose}>
      <span className="toast-icon">{type === 'mention_all' ? '📢' : '🔔'}</span>
      <span className="toast-text">{text}</span>
    </div>
  )
}

export default function App() {
  const [users, setUsers] = useState([])
  const [userId, setUserId] = useState('')
  const [roomInput, setRoomInput] = useState('')
  const [joined, setJoined] = useState(false)
  const [currentRoom, setCurrentRoom] = useState('')
  const [messages, setMessages] = useState([])
  const [inputMessage, setInputMessage] = useState('')
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')

  // { [userId]: true } — những ai đang gõ
  const [typingUsers, setTypingUsers] = useState({})
  // Toast notifications
  const [toasts, setToasts] = useState([])

  const messagesEndRef = useRef(null)
  const typingDebounceRef = useRef(null)   // debounce gửi typing:false sau 2s
  const typingTimersRef = useRef({})        // auto-hide typing sau 3s không update

  // ── Fetch danh sách user ──
  useEffect(() => {
    getUsers()
      .then((list) => {
        setUsers(list)
        const first = list.find((u) => !u.online)
        setUserId(first ? first.id : (list[0]?.id ?? ''))
      })
      .catch(() => setError('Không thể tải danh sách user từ server'))
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => () => {
    disconnect()
    clearTimeout(typingDebounceRef.current)
    Object.values(typingTimersRef.current).forEach(clearTimeout)
  }, [])

  // ── Typing: nhận event từ server ──
  const handleTyping = useCallback((event) => {
    const { userId: typingUid, typing } = event
    if (typingUid === userId) return  // bỏ qua chính mình

    clearTimeout(typingTimersRef.current[typingUid])

    if (typing) {
      setTypingUsers((prev) => ({ ...prev, [typingUid]: true }))
      // Tự ẩn sau 3s nếu không nhận update mới
      typingTimersRef.current[typingUid] = setTimeout(() => {
        setTypingUsers((prev) => {
          const next = { ...prev }
          delete next[typingUid]
          return next
        })
      }, 3000)
    } else {
      setTypingUsers((prev) => {
        const next = { ...prev }
        delete next[typingUid]
        return next
      })
    }
  }, [userId])

  // ── Notification: nhận @mention ──
  const handleNotification = useCallback((notif) => {
    if (notif.fromUserId === userId) return  // bỏ qua của chính mình

    const text = notif.type === 'mention_all'
      ? `${notif.fromUserId} đã tag tất cả: ${notif.content}`
      : `${notif.fromUserId} đã tag bạn: ${notif.content}`

    setToasts((prev) => [...prev, { id: Date.now() + Math.random(), text, type: notif.type }])
  }, [userId])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // ── Join room ──
  const handleJoin = async () => {
    const room = roomInput.trim()
    if (!room) { setError('Vui lòng nhập Sheet ID'); return }
    if (!userId) { setError('Chưa chọn user'); return }

    setJoining(true)
    setError('')

    try {
      await claimUser(userId)
    } catch (e) {
      setError(
        e.message === 'conflict'
          ? 'User đang được người khác dùng, hãy chọn user khác'
          : 'Không thể claim user, thử lại sau'
      )
      setJoining(false)
      return
    }

    disconnect()
    setMessages([])
    setTypingUsers({})
    setToasts([])

    try {
      const history = await getHistory(room)
      setMessages(Array.isArray(history) ? history : [])
    } catch {
      setMessages([])
    }

    connect(room, userId, {
      onMessage: (msg) => setMessages((prev) => [...prev, msg]),
      onTyping: handleTyping,
      onNotification: handleNotification,
    })

    setCurrentRoom(room)
    setJoined(true)
    setJoining(false)
  }

  // ── Leave room ──
  const handleLeave = () => {
    disconnect()
    clearTimeout(typingDebounceRef.current)
    Object.values(typingTimersRef.current).forEach(clearTimeout)
    typingTimersRef.current = {}
    setJoined(false)
    setCurrentRoom('')
    setMessages([])
    setRoomInput('')
    setTypingUsers({})
    setToasts([])
    setError('')
  }

  // ── Input message với typing debounce ──
  const handleInputChange = (e) => {
    const val = e.target.value
    setInputMessage(val)
    if (!joined) return

    if (val === '') {
      clearTimeout(typingDebounceRef.current)
      sendTyping(currentRoom, userId, false)
      return
    }

    sendTyping(currentRoom, userId, true)
    clearTimeout(typingDebounceRef.current)
    typingDebounceRef.current = setTimeout(() => {
      sendTyping(currentRoom, userId, false)
    }, 2000)
  }

  // ── Gửi tin nhắn ──
  const handleSend = () => {
    if (!inputMessage.trim() || !joined) return
    clearTimeout(typingDebounceRef.current)
    sendTyping(currentRoom, userId, false)
    sendMessage(currentRoom, userId, inputMessage.trim())
    setInputMessage('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const selectedUser = users.find((u) => u.id === userId)
  const typingList = Object.keys(typingUsers)

  return (
    <div className="app">
      {/* ── Toast notifications ── */}
      <div className="toast-container">
        {toasts.map((t) => (
          <Toast key={t.id} text={t.text} type={t.type} onClose={() => removeToast(t.id)} />
        ))}
      </div>

      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-left">
          <div className="header-icon">📊</div>
          <div>
            <div className="header-title">NAB Dashboard</div>
            {joined && <div className="header-sub">Sheet: {currentRoom}</div>}
          </div>
        </div>
        {joined && (
          <div className="header-user">
            <Avatar uid={userId} users={users} size={22} />
            <span>{userId}</span>
          </div>
        )}
      </header>

      {/* ── Join bar ── */}
      <div className="join-bar">
        <div className="join-bar-inner">
          <div className="field-group">
            <label className="field-label">Account</label>
            <div className="select-wrapper">
              {userId && <Avatar uid={userId} users={users} size={20} />}
              {selectedUser && (
                <span
                  className="online-dot"
                  style={{ background: selectedUser.online ? '#22c55e' : '#d1d5db' }}
                  title={selectedUser.online ? 'Online' : 'Offline'}
                />
              )}
              <select
                className="select-user"
                value={userId}
                onChange={(e) => { setUserId(e.target.value); setError('') }}
                disabled={joined || users.length === 0}
              >
                {users.length === 0 && <option value="">Loading...</option>}
                {users.map((u) => (
                  <option key={u.id} value={u.id} disabled={u.online}>
                    {u.id}{u.online ? ' (online)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field-group" style={{ flex: 1 }}>
            <label className="field-label">Sheet ID</label>
            <input
              className="input-room"
              type="text"
              placeholder="VD: Q2-2025-Report"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !joined && handleJoin()}
              disabled={joined}
            />
          </div>

          {!joined ? (
            <button
              className="btn btn-join"
              onClick={handleJoin}
              disabled={joining || users.length === 0 || selectedUser?.online}
            >
              {joining ? <><span className="spinner" /> Claiming...</> : 'Open'}
            </button>
          ) : (
            <button className="btn btn-leave" onClick={handleLeave}>Close</button>
          )}
        </div>
        {error && <div className="error-msg">{error}</div>}
      </div>

      {/* ── Chat area ── */}
      <div className="chat-area">
        {!joined ? (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <div className="empty-title">No sheet selected</div>
            <div className="empty-sub">Choose an account and enter a Sheet ID to load data</div>
          </div>
        ) : messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">✨</div>
            <div className="empty-title">Sheet "{currentRoom}" loaded</div>
            <div className="empty-sub">No records yet. Start entering data below.</div>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isOwn = msg.userId === userId
            const prevMsg = messages[idx - 1]
            const showHeader = msg.userId !== prevMsg?.userId

            return (
              <div key={msg.id ?? idx} className={`message-row ${isOwn ? 'own' : 'other'}`}>
                {!isOwn && (
                  <div className="avatar-slot">
                    {showHeader && <Avatar uid={msg.userId} users={users} size={28} />}
                  </div>
                )}
                <div className="message-body">
                  {!isOwn && showHeader && (
                    <div className="msg-username" style={{ color: getUserColor(msg.userId, users) }}>
                      {msg.userId}
                    </div>
                  )}
                  <div className={`msg-bubble ${isOwn ? 'bubble-own' : 'bubble-other'}`}>
                    <span className="msg-content">{renderContent(msg.content)}</span>
                    <span className="msg-time">{formatTime(msg.createdAt)}</span>
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Typing indicator ── */}
      <div className="typing-bar">
        {typingList.length > 0 && (
          <span className="typing-text">
            <span className="typing-dots">
              <span /><span /><span />
            </span>
            {typingList.join(', ')} đang nhập...
          </span>
        )}
      </div>

      {/* ── Input bar ── */}
      <div className="input-bar">
        {joined && <Avatar uid={userId} users={users} size={30} />}
        <input
          className="input-message"
          type="text"
          placeholder={joined ? 'Enter value... (dùng @userId để mention)' : 'Open a sheet to start editing'}
          value={inputMessage}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={!joined}
        />
        <button
          className="btn btn-send"
          onClick={handleSend}
          disabled={!joined || !inputMessage.trim()}
          title="Send (Enter)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
