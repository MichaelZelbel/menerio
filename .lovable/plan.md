

## Redirect logged-in users from "/" to "/dashboard"

### What changes
- **`src/pages/Index.tsx`**: Add a check at the top of the component. If the user has an active session (via `useAuth()`), immediately redirect to `/dashboard` using `<Navigate>`.
- That's it — one file, ~5 lines added.

### How it works
- Logged-out users: see the landing page as before
- Logged-in users: hitting `/` instantly redirects to `/dashboard`
- The `loading` state from `useAuth()` is respected so we don't flash the landing page or redirect prematurely

### Technical detail
```tsx
// At top of Index component:
const { session, loading } = useAuth();
if (loading) return <PageLoader />;
if (session) return <Navigate to="/dashboard" replace />;
```

