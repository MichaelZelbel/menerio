import { LegalLayout } from "@/components/legal/LegalLayout";

const sections = [
  { id: "acceptance", title: "Acceptance of Terms" },
  { id: "description", title: "Description of Service" },
  { id: "accounts", title: "User Accounts" },
  { id: "acceptable-use", title: "Acceptable Use" },
  { id: "ip", title: "Intellectual Property" },
  { id: "liability", title: "Limitation of Liability" },
  { id: "termination", title: "Termination" },
  { id: "changes", title: "Changes to Terms" },
  { id: "governing-law", title: "Governing Law" },
];

export default function Terms() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="March 7, 2026" sections={sections}>
      <h2 id="acceptance">Acceptance of Terms</h2>
      <p>By accessing or using [Project Name] ("the Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.</p>
      <p>We reserve the right to update these terms at any time. Continued use of the Service after changes constitutes acceptance of the modified terms.</p>

      <h2 id="description">Description of Service</h2>
      <p>[Project Name] is a web-based platform for project management, team collaboration, and workflow automation. The Service may include free and paid tiers with varying feature access.</p>
      <p>We reserve the right to modify, suspend, or discontinue any part of the Service at any time with reasonable notice.</p>

      <h2 id="accounts">User Accounts</h2>
      <p>To use certain features, you must create an account. You agree to:</p>
      <ul>
        <li>Provide accurate and complete registration information</li>
        <li>Maintain the security of your account credentials</li>
        <li>Notify us immediately of any unauthorized access</li>
        <li>Accept responsibility for all activity under your account</li>
      </ul>
      <p>You must be at least 16 years old to create an account.</p>

      <h2 id="acceptable-use">Acceptable Use Policy</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for any unlawful purpose</li>
        <li>Upload malicious code, viruses, or harmful content</li>
        <li>Attempt to gain unauthorized access to other accounts or systems</li>
        <li>Harass, abuse, or threaten other users</li>
        <li>Use the Service to send spam or unsolicited communications</li>
        <li>Reverse engineer or attempt to extract the source code</li>
        <li>Exceed reasonable usage limits or abuse API access</li>
      </ul>

      <h2 id="ip">Intellectual Property</h2>
      <p>The Service, including its design, features, and content, is owned by [Project Name] and protected by intellectual property laws. You retain ownership of content you create using the Service.</p>
      <p>By uploading content, you grant us a limited license to store, display, and process it as necessary to provide the Service.</p>

      <h2 id="liability">Limitation of Liability</h2>
      <p>To the maximum extent permitted by law, [Project Name] shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service.</p>
      <p>Our total liability shall not exceed the amount you paid us in the twelve months preceding the claim. The Service is provided "as is" without warranties of any kind.</p>

      <h2 id="termination">Termination</h2>
      <p>We may suspend or terminate your account if you violate these terms or engage in activities that harm other users or the Service. You may delete your account at any time through the Settings page.</p>
      <p>Upon termination, your right to use the Service ceases immediately. We may retain certain data as required by law.</p>

      <h2 id="changes">Changes to Terms</h2>
      <p>We may update these Terms of Service from time to time. We will notify you of significant changes via email or an in-app notification. Your continued use of the Service after changes take effect constitutes acceptance.</p>

      <h2 id="governing-law">Governing Law</h2>
      <p>These Terms shall be governed by and construed in accordance with the laws of [Your Jurisdiction], without regard to conflict of law principles.</p>
      <p>Any disputes arising from these Terms shall be resolved in the courts of [Your Jurisdiction].</p>
    </LegalLayout>
  );
}
