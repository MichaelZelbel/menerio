import { owner } from './client';
// Synthetic auth context only. The actual feature hooks and PersonDetail render
// unchanged; the local SQL adapter sets the authenticated owner/role on queries.
export const useAuth = () => ({ user: { id: owner }, session: null, profile: { display_name: 'Synthetic test owner' }, role: 'premium', loading: false });
