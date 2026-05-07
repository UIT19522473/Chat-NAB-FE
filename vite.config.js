import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

function firebaseSwPlugin(env) {
  const swContent = `\
importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: '${env.VITE_FIREBASE_API_KEY ?? ''}',
  authDomain: '${env.VITE_FIREBASE_AUTH_DOMAIN ?? ''}',
  projectId: '${env.VITE_FIREBASE_PROJECT_ID ?? ''}',
  storageBucket: '${env.VITE_FIREBASE_STORAGE_BUCKET ?? ''}',
  messagingSenderId: '${env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? ''}',
  appId: '${env.VITE_FIREBASE_APP_ID ?? ''}',
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title ?? 'NAB Dashboard'
  const body = payload.notification?.body ?? ''
  const icon = payload.notification?.icon ?? '/vite.svg'
  self.registration.showNotification(title, {
    body,
    icon,
    badge: icon,
    data: payload.data ?? {},
    vibrate: [200, 100, 200],
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url
    ? event.notification.data.url
    : self.location.origin

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            if (targetUrl !== self.location.origin) client.navigate(targetUrl)
            return client.focus()
          }
        }
        return clients.openWindow(targetUrl)
      })
  )
})
`

  return {
    name: 'firebase-sw-generator',
    buildStart() {
      const dest = path.resolve('./public/firebase-messaging-sw.js')
      fs.writeFileSync(dest, swContent, 'utf-8')
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), firebaseSwPlugin(env)],
    server: { port: 3000 },
  }
})
