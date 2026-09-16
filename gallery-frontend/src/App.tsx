import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import GalleryView from './pages/GalleryView';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Consolidated landing page (Public Portfolio + PIN Entry + Admin Login) */}
        <Route path="/" element={<Home />} />

        {/* Gallery View */}
        <Route path="/g/:id" element={<GalleryView />} />

        {/* Catch-all redirect to Home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}