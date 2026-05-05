const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'

// Trả về [{ id, online }, ...]
export async function getUsers() {
  const res = await fetch(`${BASE_URL}/api/users`)
  if (!res.ok) throw new Error(`getUsers failed: ${res.status}`)
  return res.json()
}

export async function claimUser(userId) {
  const res = await fetch(`${BASE_URL}/api/users/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  })

  if (res.status === 409) throw new Error('conflict')
  if (!res.ok) throw new Error(`claimUser failed: ${res.status}`)
}

export async function getHistory(roomId) {
  const res = await fetch(`${BASE_URL}/api/rooms/${roomId}/messages`)
  if (!res.ok) throw new Error(`getHistory failed: ${res.status}`)
  return res.json()
}