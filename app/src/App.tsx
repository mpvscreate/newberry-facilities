import { BrowserRouter, Routes, Route } from 'react-router-dom'
import OrgPage from './pages/OrgPage'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/:orgSlug" element={<OrgPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
