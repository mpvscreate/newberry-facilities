import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <h1>404</h1>
      <p>Page not found</p>
      <Link to="/" style={{ color: '#6aaa5e', marginTop: 12, display: 'inline-block' }}>
        Go home
      </Link>
    </div>
  )
}
