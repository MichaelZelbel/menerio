import { SEOHead } from "@/components/SEOHead";
import { LegalLayout } from "@/components/legal/LegalLayout";

const sections = [
  { id: "not-allowed", title: "What's Not Allowed" },
  { id: "sexual", title: "Sexually Explicit Content" },
  { id: "hate", title: "Hate Speech & Harassment" },
  { id: "malware", title: "Malware & Malicious Content" },
  { id: "personal-info", title: "Personal Information" },
  { id: "spam", title: "Spam" },
  { id: "how-moderation-works", title: "How Moderation Works" },
  { id: "strikes", title: "Strikes & Restrictions" },
  { id: "appeals", title: "Appeals" },
  { id: "changes", title: "Changes" },
];

export default function CommunityGuidelines() {
  return (
    <LegalLayout title="Community Guidelines" lastUpdated="April 5, 2026" sections={sections}>
      <SEOHead
        title="Community Guidelines — Menerio"
        description="Guidelines for sharing content publicly on Menerio. Learn what's allowed and how moderation works."
      />

      <p>Menerio is a platform for organizing your knowledge, ideas, and notes. When you share a note publicly, it becomes visible to anyone with the link. We want shared content to be useful, respectful, and safe.</p>
      <p>These guidelines apply to all publicly shared notes. Private notes are not moderated.</p>

      <h2 id="not-allowed">What's not allowed</h2>

      <h3 id="sexual">Sexually explicit content</h3>
      <p>Do not share notes containing pornography, erotica, or sexually explicit material. Notes about health education or academic topics are fine when presented appropriately.</p>

      <h3 id="hate">Hate speech &amp; harassment</h3>
      <p>Do not share notes that contain slurs, threats, or targeted harassment. Do not use shared notes to defame, bully, or incite violence against individuals or groups.</p>

      <h3 id="malware">Malware &amp; malicious content</h3>
      <p>Do not share notes containing malware instructions, phishing templates, exploit code, or other content designed to harm systems or steal data.</p>

      <h3 id="personal-info">Personal information</h3>
      <p>Do not share notes containing other people's personal information such as home addresses, phone numbers, financial details, or government ID numbers without their explicit consent.</p>

      <h3 id="spam">Spam</h3>
      <p>Do not use shared notes to distribute spam, scam content, or deceptive marketing material.</p>

      <h2 id="how-moderation-works">How moderation works</h2>
      <p>When you share a note publicly, our system performs an automated check:</p>
      <ol>
        <li><strong>Instant check</strong>: A fast keyword-based filter catches obvious violations and blocks the share immediately.</li>
        <li><strong>AI review</strong>: After a note is shared, our AI reviews the content in the background. If a clear violation is detected, the share link is automatically removed and you'll receive an email notification.</li>
      </ol>
      <p>Both systems are designed to minimize false positives. Legitimate content about technology, programming, health, and other sensitive-but-normal topics is expected and welcome.</p>

      <h2 id="strikes">Strikes &amp; account restrictions</h2>
      <p>Each blocked violation adds a strike to your account:</p>
      <ul>
        <li><strong>1–4 strikes</strong>: You receive a warning. You can still use the platform normally.</li>
        <li><strong>5+ strikes</strong>: Your ability to share notes publicly is temporarily suspended.</li>
      </ul>
      <p>Strike counts are reviewed periodically, and we may reset strikes for users who demonstrate good-faith usage.</p>

      <h2 id="appeals">Appeals</h2>
      <p>If you believe your content was incorrectly flagged, please contact us at <a href="mailto:support@menerio.com" className="text-primary hover:underline">support@menerio.com</a>. We review all appeals manually and will restore your content if the moderation was in error.</p>

      <h2 id="changes">Changes</h2>
      <p>We may update these guidelines as our platform evolves. Significant changes will be communicated through the app.</p>
    </LegalLayout>
  );
}
