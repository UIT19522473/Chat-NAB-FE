import { Client } from '@stomp/stompjs'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws'

let stompClient = null

export function connect(roomId, userId, { onMessage, onTyping, onNotification }) {
  stompClient = new Client({
    brokerURL: WS_URL,
    connectHeaders: { userId },
    reconnectDelay: 5000,
    onConnect: () => {
      stompClient.subscribe(`/topic/rooms/${roomId}`, (frame) => {
        try { onMessage(JSON.parse(frame.body)) }
        catch { console.error('Bad message frame:', frame.body) }
      })

      stompClient.subscribe(`/topic/rooms/${roomId}/typing`, (frame) => {
        try { onTyping(JSON.parse(frame.body)) }
        catch { console.error('Bad typing frame:', frame.body) }
      })

      stompClient.subscribe(`/topic/rooms/${roomId}/notifications`, (frame) => {
        try { onNotification(JSON.parse(frame.body)) }
        catch { console.error('Bad room notif frame:', frame.body) }
      })

      stompClient.subscribe(`/topic/users/${userId}/notifications`, (frame) => {
        try { onNotification(JSON.parse(frame.body)) }
        catch { console.error('Bad user notif frame:', frame.body) }
      })
    },
    onStompError: (frame) => {
      console.error('STOMP error:', frame.headers['message'])
    },
  })

  stompClient.activate()
}

export function disconnect() {
  if (stompClient) {
    stompClient.deactivate()
    stompClient = null
  }
}

export function sendMessage(roomId, userId, content) {
  if (!stompClient?.connected) return
  stompClient.publish({
    destination: `/app/rooms/${roomId}/send`,
    body: JSON.stringify({ userId, content }),
  })
}

export function sendTyping(roomId, userId, typing) {
  if (!stompClient?.connected) return
  stompClient.publish({
    destination: `/app/rooms/${roomId}/typing`,
    body: JSON.stringify({ userId, typing }),
  })
}