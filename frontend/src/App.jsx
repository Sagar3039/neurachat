import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { ChatProvider } from './contexts/ChatContext.jsx';
import { ToastProvider } from './components/UI/Toast.jsx';
import ErrorBoundary from './components/UI/ErrorBoundary.jsx';
import ProtectedRoute from './components/Auth/ProtectedRoute.jsx';
import LoginPage from './components/Auth/LoginPage.jsx';
import AppLayout from './components/Layout/AppLayout.jsx';

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <ChatProvider>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <AppLayout />
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ChatProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
