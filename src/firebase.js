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
  if (!('Notification' in window)) {
    console.warn('FCM: browser does not support notifications')
    return null
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    console.warn('FCM: notification permission denied')
    return null
  }

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY
  if (!vapidKey) {
    console.warn('FCM: VITE_FIREBASE_VAPID_KEY is not set')
    return null
  }

  try {
    const token = await getToken(messaging, { vapidKey })
    console.log('FCM Token:', token)
    return token
  } catch (err) {
    console.error('FCM: failed to get token:', err)
    return null
  }
}

// Call once after app mounts; onToast receives { title, body, data }
// Caller is responsible for showing native notification if needed.
export function initForegroundNotifications(onToast) {
  onMessage(messaging, (payload) => {
    const title = payload.notification?.title ?? 'NAB Dashboard'
    const body = payload.notification?.body ?? ''
    onToast({ title, body, data: payload.data ?? {} })
  })
}
