import { LegalLayout } from "@/components/legal/LegalLayout";

const sections = [
  { id: "what", title: "What Are Cookies" },
  { id: "types", title: "Types We Use" },
  { id: "manage", title: "Managing Cookies" },
  { id: "third-party", title: "Third-Party Cookies" },
];

export default function Cookies() {
  return (
    <LegalLayout title="Cookie Policy" lastUpdated="March 7, 2026" sections={sections}>
      <h2 id="what">What Are Cookies</h2>
      <p>Cookies are small text files stored on your device when you visit a website. They help the site remember your preferences and understand how you interact with it.</p>
      <p>[Project Name] uses cookies and similar technologies (such as localStorage) to provide, protect, and improve the Service.</p>

      <h2 id="types">Types of Cookies We Use</h2>
      <h3>Essential Cookies</h3>
      <p>These are required for the Service to function. They include:</p>
      <ul>
        <li><strong>Authentication cookies</strong> — Keep you signed in and maintain your session</li>
        <li><strong>Security cookies</strong> — Protect against cross-site request forgery</li>
        <li><strong>Preference cookies</strong> — Remember your cookie consent choice and theme preference</li>
      </ul>

      <h3>Analytics Cookies</h3>
      <p>We may use analytics cookies to understand how visitors interact with the Service. These cookies collect anonymous data such as:</p>
      <ul>
        <li>Pages visited and time spent</li>
        <li>Referral sources</li>
        <li>Browser and device type</li>
      </ul>
      <p>This data helps us improve performance and user experience.</p>

      <h3>Preference Cookies</h3>
      <p>These cookies remember your choices (such as theme, language, or layout preferences) to provide a more personalised experience.</p>

      <h2 id="manage">How to Manage Cookies</h2>
      <p>You can manage your cookie preferences at any time:</p>
      <ul>
        <li><strong>Cookie banner</strong> — Use the consent banner that appears on your first visit to accept or reject non-essential cookies</li>
        <li><strong>Browser settings</strong> — Most browsers allow you to block or delete cookies through their settings menu</li>
        <li><strong>Device settings</strong> — Mobile devices have privacy settings that control cookie behaviour</li>
      </ul>
      <p>Please note that disabling essential cookies may prevent certain features from working correctly.</p>

      <h2 id="third-party">Third-Party Cookies</h2>
      <p>Some third-party services integrated with [Project Name] may set their own cookies:</p>
      <ul>
        <li><strong>Supabase</strong> — Authentication and session management</li>
        <li><strong>Google</strong> — If you sign in with Google OAuth</li>
        <li><strong>GitHub</strong> — If you sign in with GitHub OAuth</li>
      </ul>
      <p>We do not control third-party cookies. Please refer to their respective privacy policies for more information.</p>
    </LegalLayout>
  );
}
