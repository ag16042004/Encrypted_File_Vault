import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/Layout.jsx";
import Landing from "./pages/Landing.jsx";
import { Register, RecoveryKeyPage, DonePage, Login, Forgot } from "./pages/Auth.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Upload from "./pages/Upload.jsx";
import Files, { Recent, SearchPage } from "./pages/Files.jsx";
import { Trash, ActivityPage } from "./pages/TrashActivity.jsx";
import { Security, SettingsPage } from "./pages/SecuritySettings.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/register" element={<Register />} />
      <Route path="/register/recovery" element={<RecoveryKeyPage />} />
      <Route path="/register/done" element={<DonePage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot" element={<Forgot />} />
      <Route element={<AppShell />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/files" element={<Files />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/recent" element={<Recent />} />
        <Route path="/trash" element={<Trash />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/security" element={<Security />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/search" element={<SearchPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
