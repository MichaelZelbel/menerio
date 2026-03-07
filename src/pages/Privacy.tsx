import { SEOHead } from "@/components/SEOHead";
import { LegalLayout } from "@/components/legal/LegalLayout";

const sections = [
  { id: "collect", title: "Information We Collect" },
  { id: "use", title: "How We Use It" },
  { id: "storage", title: "Data Storage & Security" },
  { id: "third-party", title: "Third-Party Services" },
  { id: "rights", title: "Your Rights" },
  { id: "cookies", title: "Cookies" },
  { id: "contact", title: "Contact" },
];

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="March 7, 2026" sections={sections}>
      <h2 id="collect">Information We Collect</h2>
      <p>We collect information you provide directly when you create an account, update your profile, or contact us. This includes:</p>
      <ul>
        <li>Account information (email address, display name, avatar)</li>
        <li>Profile data (bio, website URL)</li>
        <li>Usage data (features used, pages visited, timestamps)</li>
        <li>Device and browser information (IP address, browser type, operating system)</li>
      </ul>

      <h2 id="use">How We Use Your Information</h2>
      <p>We use the information we collect to:</p>
      <ul>
        <li>Provide, maintain, and improve our services</li>
        <li>Create and manage your account</li>
        <li>Send transactional emails (account verification, password resets)</li>
        <li>Analyze usage patterns to improve user experience</li>
        <li>Detect and prevent fraud or abuse</li>
        <li>Comply with legal obligations</li>
      </ul>

      <h2 id="storage">Data Storage and Security</h2>
      <p>Your data is stored securely using industry-standard encryption. We use Supabase as our backend infrastructure provider, which employs:</p>
      <ul>
        <li>AES-256 encryption at rest</li>
        <li>TLS 1.3 encryption in transit</li>
        <li>Row-level security (RLS) for data isolation</li>
        <li>Regular automated backups</li>
      </ul>
      <p>While we implement robust security measures, no method of electronic storage is 100% secure. We encourage you to use strong, unique passwords.</p>

      <h2 id="third-party">Third-Party Services</h2>
      <p>We use the following third-party services to operate [Project Name]:</p>
      <ul>
        <li><strong>Supabase</strong> — Authentication, database, and file storage</li>
        <li><strong>Analytics providers</strong> — Anonymous usage analytics to improve the product</li>
        <li><strong>OAuth providers</strong> — Google and GitHub for social sign-in</li>
      </ul>
      <p>Each third-party service has its own privacy policy governing their use of your data.</p>

      <h2 id="rights">Your Rights</h2>
      <h3>Under GDPR (EU/EEA residents)</h3>
      <p>You have the right to access, rectify, erase, restrict processing, data portability, and object to processing of your personal data. You may also withdraw consent at any time.</p>
      <h3>Under CCPA (California residents)</h3>
      <p>You have the right to know what personal information is collected, request deletion, opt-out of the sale of personal information (we do not sell your data), and non-discrimination for exercising your rights.</p>
      <p>To exercise any of these rights, please contact us using the information below.</p>

      <h2 id="cookies">Cookies</h2>
      <p>We use essential cookies to maintain your session and preferences. We may also use analytics cookies to understand how our service is used. For full details, see our <a href="/cookies" className="text-primary hover:underline">Cookie Policy</a>.</p>

      <h2 id="contact">Contact Information</h2>
      <p>If you have questions about this Privacy Policy or wish to exercise your data rights, contact us at:</p>
      <ul>
        <li>Email: privacy@[projectname].com</li>
        <li>Address: [Your Company Address]</li>
      </ul>
    </LegalLayout>
  );
}
