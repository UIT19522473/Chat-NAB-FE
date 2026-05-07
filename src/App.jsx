import { useState, useEffect, useRef, useCallback } from 'react'
import { getUsers, claimUser, getHistory, saveFcmToken } from './api.js'
import { connect, disconnect, sendMessage, sendTyping } from './chatSocket.js'
import { requestNotificationPermission, initForegroundNotifications } from './firebase.js'
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

function Toast({ sender, content, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000)
    return () => clearTimeout(t)
  }, [onClose])

  const isMentionAll = type === 'mention_all'

  return (
    <div className={`toast toast-${type}`} onClick={onClose}>
      <span className="toast-type-dot">{isMentionAll ? '📢' : '@'}</span>
      <div className="toast-body">
        <div className="toast-sender">
          {isMentionAll ? 'Tag tất cả' : `${sender} tag bạn`}
        </div>
        <div className="toast-content">{content}</div>
      </div>
      <button className="toast-close" onClick={(e) => { e.stopPropagation(); onClose() }}>✕</button>
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
  //masking message
  const [maskOff, setMaskOff] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const maskTimerRef = useRef(null)
  const countdownRef = useRef(null)
  //suggest name when taging
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionSuggestions = [
    { id: 'all', special: true },
    ...users.filter((u) => u.id !== userId)
  ]
    .filter((u) => u.id.toLowerCase().includes(mentionQuery.toLowerCase()))
    .slice(0, 6)

  // { [userId]: true } — những ai đang gõ
  const [typingUsers, setTypingUsers] = useState({})
  // Toast notifications
  const [toasts, setToasts] = useState([])

  const messagesEndRef = useRef(null)
  const typingDebounceRef = useRef(null)
  const typingTimersRef = useRef({})

  // Notification toggle — dùng ref để callback STOMP luôn đọc giá trị mới nhất
  const notiEnabledRef = useRef(localStorage.getItem('notiEnabled') !== 'false')
  const [notiEnabled, setNotiEnabled] = useState(notiEnabledRef.current)

  const toggleNoti = () => {
    const next = !notiEnabledRef.current
    notiEnabledRef.current = next
    setNotiEnabled(next)
    localStorage.setItem('notiEnabled', String(next))
  }

  const showLocalNotification = useCallback((title, body) => {
    if (!notiEnabledRef.current) return
    if (Notification.permission !== 'granted') return
    if (!document.hidden) return   // tab đang mở và focus → không cần native popup
    const n = new Notification(title, {
      body: body.length > 120 ? body.slice(0, 117) + '...' : body,
      icon: '/vite.svg',
      tag: `nab-${Date.now()}`,
    })
    n.onclick = () => { window.focus(); n.close() }
  }, [])

  // pet :))
  const petRef = useRef(null)

  const petPosRef = useRef({ x: 120, y: 160 })
  const petVelocityRef = useRef({ vx: 0.6, vy: 0.4 })
  const petMouseRef = useRef({ x: -9999, y: -9999 })

  useEffect(() => {
    let rafId

    const animatePet = () => {
      const pet = petRef.current
      if (!pet) return

      const pos = petPosRef.current
      const velocity = petVelocityRef.current

      const maxX = window.innerWidth - 60
      const maxY = window.innerHeight - 80

      // bay tự nhiên
      pos.x += velocity.vx
      pos.y += velocity.vy

      // né chuột
      const mouse = petMouseRef.current
      const dx = pos.x - mouse.x
      const dy = pos.y - mouse.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < 120) {
        const force = (120 - dist) / 120
        velocity.vx += (dx / Math.max(dist, 1)) * force * 0.25
        velocity.vy += (dy / Math.max(dist, 1)) * force * 0.25
      }

      // chạm biên thì bật lại
      if (pos.x <= 0 || pos.x >= maxX) velocity.vx *= -1
      if (pos.y <= 36 || pos.y >= maxY) velocity.vy *= -1

      pos.x = Math.max(0, Math.min(maxX, pos.x))
      pos.y = Math.max(36, Math.min(maxY, pos.y))

      // giới hạn tốc độ
      velocity.vx = Math.max(-2.2, Math.min(2.2, velocity.vx))
      velocity.vy = Math.max(-1.8, Math.min(1.8, velocity.vy))

      // giảm tốc nhẹ → mượt
      velocity.vx *= 0.995
      velocity.vy *= 0.995

      pet.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`

      rafId = requestAnimationFrame(animatePet)
    }

    rafId = requestAnimationFrame(animatePet)

    return () => cancelAnimationFrame(rafId)
  }, [])

  useEffect(() => {
    const handleMouseMove = (e) => {
      petMouseRef.current = { x: e.clientX, y: e.clientY }
    }

    window.addEventListener('mousemove', handleMouseMove)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
    }
  }, [])

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

  // ── FCM foreground notifications ──
  useEffect(() => {
    // FCM chỉ dùng để show native OS notification khi tab closed/hidden
    // STOMP đã xử lý in-app toast, không tạo toast từ FCM để tránh duplicate
    initForegroundNotifications(({ title, body, data }) => {
      if (data?.fromUserId && data.fromUserId === userId) return
      showLocalNotification(title, body)
    })
  }, [showLocalNotification, userId])

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
    if (notif.fromUserId === userId) return

    setToasts((prev) => [...prev, {
      id: Date.now() + Math.random(),
      sender: notif.fromUserId,
      content: notif.content,
      type: notif.type,
    }])

    // Native OS notification khi tab không focus
    const label = notif.type === 'mention_all'
      ? `${notif.fromUserId} tag tất cả`
      : `${notif.fromUserId} tag bạn`
    showLocalNotification(label, notif.content)
  }, [userId, showLocalNotification])

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
      onMessage: (msg) => {
        setMessages((prev) => [...prev, msg])
        if (msg.userId !== userId) {
          showLocalNotification(msg.userId, msg.content)
        }
      },
      onTyping: handleTyping,
      onNotification: handleNotification,
    })

    setCurrentRoom(room)
    setJoined(true)
    setJoining(false)

    requestNotificationPermission().then((token) => {
      if (token) saveFcmToken(userId, token).catch(() => {})
    })
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

    const beforeCursor = val.slice(0, e.target.selectionStart)
    const match = beforeCursor.match(/@([a-zA-Z0-9_]*)$/)

    if (match) {
      setMentionOpen(true)
      setMentionQuery(match[1])
      setMentionIndex(0)
    } else {
      setMentionOpen(false)
      setMentionQuery('')
    }

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
    if (mentionOpen && mentionSuggestions.length > 0) {
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        applyMention(mentionSuggestions[mentionIndex].id)
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((prev) => (prev + 1) % mentionSuggestions.length)
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((prev) =>
          prev === 0 ? mentionSuggestions.length - 1 : prev - 1
        )
        return
      }

      if (e.key === 'Escape') {
        setMentionOpen(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const selectedUser = users.find((u) => u.id === userId)
  const typingList = Object.keys(typingUsers)

  // -- An hien tin nhan
  const handleToggleMask = () => {
    if (maskOff) {
      // đang mở → tắt ngay
      setMaskOff(false)
      setCountdown(0)
      clearTimeout(maskTimerRef.current)
      clearInterval(countdownRef.current)
      return
    }

    // đang tắt → bật 10s
    setMaskOff(true)
    setCountdown(10)

    clearTimeout(maskTimerRef.current)
    clearInterval(countdownRef.current)

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    maskTimerRef.current = setTimeout(() => {
      setMaskOff(false)
    }, 10000)
  }

  useEffect(() => {
    return () => {
      clearTimeout(maskTimerRef.current)
      clearInterval(countdownRef.current)
    }
  }, [])

  //handle metion
  const applyMention = (selectedId) => {
  const beforeCursor = inputMessage
  const replaced = beforeCursor.replace(/@([a-zA-Z0-9_]*)$/, `@${selectedId} `)

  setInputMessage(replaced)
  setMentionOpen(false)
  setMentionQuery('')
  setMentionIndex(0)
}

const renderContent = (content = '', isMine = false) => {
  const parts = content.split(/(@\w+)/g)

  return parts.map((part, idx) => {
    if (part.startsWith('@')) {
      const mentionId = part.slice(1)

      if (mentionId.toLowerCase() === 'all') {
        return <span key={idx} className={`mention ${isMine ? 'mention-all-mine' : 'mention-all'}`}>{part}</span>
      }

      if (mentionId === userId) {
        return <span key={idx} className={`mention ${isMine ? 'mention-self-mine' : 'mention-self'}`}>{part}</span>
      }

      return <span key={idx} className={`mention ${isMine ? 'mention-other-mine' : 'mention-other'}`}>{part}</span>
    }

    return part
  })
}

  return (
    <div className="app">
      {/* ── Toast notifications ── */}
      <div className="toast-container">
        {toasts.map((t) => (
          <Toast key={t.id} sender={t.sender} content={t.content} type={t.type} onClose={() => removeToast(t.id)} />
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
        <div className="header-actions">
          <button
            className={`noti-btn ${notiEnabled ? 'on' : 'off'}`}
            onClick={toggleNoti}
            title={notiEnabled ? 'Tắt thông báo' : 'Bật thông báo'}
          >
            {notiEnabled ? '🔔' : '🔕'}
          </button>
          <button
            className={`peek-btn ${maskOff ? 'active' : ''}`}
            onClick={handleToggleMask}
          >
            👁 {maskOff ? `${countdown}s` : 'Peek'}
          </button>
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
                    <span className={`msg-content ${maskOff ? '' : 'msg-content-masked'}`}>
                      {renderContent(msg.content, isOwn)}
                    </span>
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
      <div className={`typing-bar ${typingList.length > 0 ? 'has-typers' : ''}`}>
        {typingList.length > 0 && (
          <div className="typing-content">
            <div className="typing-avatars">
              {typingList.slice(0, 3).map((uid) => (
                <Avatar key={uid} uid={uid} users={users} size={22} />
              ))}
            </div>
            <div className="typing-bubble">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
            <span className="typing-label">
              {typingList.length === 1
                ? `${typingList[0]} đang nhập`
                : `${typingList.slice(0, 2).join(', ')}${typingList.length > 2 ? ` +${typingList.length - 2}` : ''} đang nhập`}
            </span>
          </div>
        )}
      </div>

      {/* ── Input bar ── */}
      <div className="input-bar">
        {joined && <Avatar uid={userId} users={users} size={30} />}
        {mentionOpen && mentionSuggestions.length > 0 && (
          <div className="mention-suggestions">
            {mentionSuggestions.map((u, idx) => (
              <button
                key={u.id}
                type="button"
                className={`mention-option ${idx === mentionIndex ? 'active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  applyMention(u.id)
                }}
              >
                <Avatar uid={u.id} users={users} size={22} />
                <span>@{u.id}</span>
                {u.special && <span className="mention-badge">ALL</span>}
                {idx === mentionIndex && <kbd>Tab</kbd>}
              </button>
            ))}
          </div>
        )}
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
      <div className="screen-pet" ref={petRef}>
        💸
      </div>
    </div>
  )
}
