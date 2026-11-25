import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { LocaleProvider } from './contexts/LocaleContext';
import { ToastProvider } from './contexts/ToastContext';

import AdminLayout from './components/layout/AdminLayout';
import LoginPage from './pages/auth/LoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import VerifyEmailPage from './pages/auth/VerifyEmailPage';

import InstallerPage from './pages/system/InstallerPage';
import EmbedPlayerPage from './pages/system/EmbedPlayerPage';
import AccountPage from './pages/system/AccountPage';
import NotificationsPage from './pages/system/NotificationsPage';
import SettingsPage from './pages/system/SettingsPage';
import ApiExplorerPage from './pages/system/ApiExplorerPage';

import DashboardPage from './pages/DashboardPage';
import MoviesPage from './pages/catalog/MoviesPage';
import EpisodicCatalogPage from './pages/catalog/EpisodicCatalogPage';
import MangasPage from './pages/catalog/MangasPage';
import StreamingPage from './pages/catalog/StreamingPage';
import ReelsPage from './pages/catalog/ReelsPage';
import FeaturedPage from './pages/catalog/FeaturedPage';
import Top10Page from './pages/catalog/Top10Page';
import UpcomingPage from './pages/catalog/UpcomingPage';
import PreviewsPage from './pages/catalog/PreviewsPage';
import RequestsPage from './pages/catalog/RequestsPage';
import VideoConversionPage from './pages/catalog/VideoConversionPage';

import TaxonomyCrudPage from './pages/taxonomies/TaxonomyCrudPage';
import CastersPage from './pages/taxonomies/CastersPage';
import ServersDrmPage from './pages/infrastructure/ServersDrmPage';
import HeadersUserAgentsPage from './pages/infrastructure/HeadersUserAgentsPage';

import UsersPage from './pages/community/UsersPage';
import ModeratorsPage from './pages/community/ModeratorsPage';
import { CommentsPage, ReportsPage, SuggestionsPage } from './pages/community/CommunityPages';

import {
  PlansSubscriptionsPage,
  OfflinePaymentsPage,
  CreditsPage,
  AdsManagerPage,
} from './pages/monetization/MonetizationPages';

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300 text-sm">
        Loading EasyPlex WebPanel...
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<Navigate to="/login" replace />} />
                <Route path="/password/reset" element={<ForgotPasswordPage />} />
                <Route path="/password/reset/:token" element={<ResetPasswordPage />} />
                <Route path="/email/verify" element={<VerifyEmailPage />} />
                <Route path="/installer" element={<InstallerPage />} />
                <Route path="/embed/:embedId" element={<EmbedPlayerPage />} />
                <Route path="/home" element={<Navigate to="/admin" replace />} />

                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute>
                      <AdminLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<DashboardPage />} />
                  <Route path="account" element={<AccountPage />} />
                  <Route path="movies" element={<MoviesPage />} />
                  <Route path="series" element={<EpisodicCatalogPage key="serie" kind="serie" />} />
                  <Route path="animes" element={<EpisodicCatalogPage key="anime" kind="anime" />} />
                  <Route path="mangas" element={<MangasPage />} />
                  <Route path="streaming" element={<StreamingPage />} />
                  <Route path="reels" element={<ReelsPage />} />
                  <Route path="featured" element={<FeaturedPage />} />
                  <Route path="top10" element={<Top10Page />} />
                  <Route path="upcoming" element={<UpcomingPage />} />
                  <Route path="previews" element={<PreviewsPage />} />
                  <Route path="requests" element={<RequestsPage />} />
                  <Route path="video-conversion" element={<VideoConversionPage />} />

                  <Route path="genres" element={<TaxonomyCrudPage key="genres" kind="genres" />} />
                  <Route path="categories" element={<TaxonomyCrudPage key="categories" kind="categories" />} />
                  <Route path="collections" element={<TaxonomyCrudPage key="collections" kind="collections" />} />
                  <Route path="networks" element={<TaxonomyCrudPage key="networks" kind="networks" />} />
                  <Route path="certifications" element={<TaxonomyCrudPage key="certifications" kind="certifications" />} />
                  <Route path="languages" element={<TaxonomyCrudPage key="languages" kind="languages" />} />
                  <Route path="casters" element={<CastersPage />} />
                  <Route path="servers" element={<ServersDrmPage />} />
                  <Route path="headers" element={<HeadersUserAgentsPage />} />

                  <Route path="users" element={<UsersPage />} />
                  <Route path="moderators" element={<ModeratorsPage />} />
                  <Route path="comments" element={<CommentsPage />} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="suggestions" element={<SuggestionsPage />} />

                  <Route path="plans" element={<PlansSubscriptionsPage />} />
                  <Route path="offline-payments" element={<OfflinePaymentsPage />} />
                  <Route path="credits" element={<CreditsPage />} />
                  <Route path="ads" element={<AdsManagerPage />} />

                  <Route path="notifications" element={<NotificationsPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="api-explorer" element={<ApiExplorerPage />} />
                </Route>

                <Route path="*" element={<Navigate to="/admin" replace />} />
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
