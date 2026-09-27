export default async function teardown() {
  try { await fetch('http://127.0.0.1:4178/__shutdown', { method: 'POST' }); } catch { /* Already closed. */ }
}
