import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { SITE_NAME } from "./config";
import SongsPage from "./pages/SongsPage";
import SongFormPage from "./pages/SongFormPage";
import SongPage from "./pages/SongPage";
import GigsPage from "./pages/GigsPage";
import GigPage from "./pages/GigPage";
import TracksPage from "./pages/TracksPage";
import "./styles.css";

function Placeholder({ title }: { title: string }) {
  return (
    <main className="page">
      <h1>{title}</h1>
      <p className="muted">Coming soon.</p>
    </main>
  );
}

export function AppRoutes() {
  return (
    <>
      <header className="topbar">{SITE_NAME}</header>
      <Routes>
        <Route path="/" element={<GigsPage />} />
        <Route path="/gigs/:id" element={<GigPage />} />
        <Route path="/songs" element={<SongsPage />} />
        <Route path="/songs/new" element={<SongFormPage />} />
        <Route path="/songs/:id/edit" element={<SongFormPage />} />
        <Route path="/songs/:id" element={<SongPage />} />
        <Route path="/tracks" element={<TracksPage />} />
        <Route path="*" element={<Placeholder title="Not found" />} />
      </Routes>
      <nav className="bottom-nav" aria-label="Main">
        <NavLink to="/" end>Gigs</NavLink>
        <NavLink to="/songs">Songs</NavLink>
        <NavLink to="/tracks">Our Songs</NavLink>
      </nav>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
