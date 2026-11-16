import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import LibraryPage from "./app/LibraryPage";

// The reader pulls in react-pageflip and pdf.js, so it loads on demand.
const ReaderPage = lazy(() => import("./app/ReaderPage"));
const SettingsPage = lazy(() => import("./app/SettingsPage"));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="min-h-dvh bg-paper" />}>
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/read/:bookId" element={<ReaderPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<LibraryPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
