import { initializeApp } from 'firebase/app'
import { getMessaging, getToken, onMessage } from 'firebase/messaging'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
const messaging = getMessaging(app)

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return null

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY
  if (!vapidKey) return null

  try {
    return await getToken(messaging, { vapidKey })
  } catch {
    return null
  }
}

export function initForegroundNotifications(onToast) {
  onMessage(messaging, (payload) => {
    const title = payload.notification?.title ?? 'NAB Dashboard'
    const body = payload.notification?.body ?? ''
    onToast({ title, body, data: payload.data ?? {} })
  })
}
