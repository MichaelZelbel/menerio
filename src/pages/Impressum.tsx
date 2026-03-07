import { LegalLayout } from "@/components/legal/LegalLayout";

const sections = [
  { id: "company", title: "Company Information" },
  { id: "contact", title: "Contact Details" },
  { id: "registration", title: "Registration" },
  { id: "vat", title: "VAT Information" },
  { id: "responsible", title: "Responsible Person" },
  { id: "dispute", title: "Dispute Resolution" },
];

export default function Impressum() {
  return (
    <LegalLayout title="Impressum" lastUpdated="March 7, 2026" sections={sections}>
      <h2 id="company">Company Information</h2>
      <p>Information in accordance with § 5 TMG (German Telemedia Act):</p>
      <ul>
        <li><strong>Company Name:</strong> [Project Name] GmbH</li>
        <li><strong>Legal Form:</strong> Gesellschaft mit beschränkter Haftung (GmbH)</li>
        <li><strong>Address:</strong> [Street Address], [Postal Code] [City], [Country]</li>
      </ul>

      <h2 id="contact">Contact Details</h2>
      <ul>
        <li><strong>Email:</strong> contact@[projectname].com</li>
        <li><strong>Phone:</strong> +49 [Phone Number]</li>
        <li><strong>Website:</strong> https://[projectname].com</li>
      </ul>

      <h2 id="registration">Registration Information</h2>
      <ul>
        <li><strong>Commercial Register:</strong> Amtsgericht [City]</li>
        <li><strong>Registration Number:</strong> HRB [Number]</li>
      </ul>

      <h2 id="vat">VAT Information</h2>
      <ul>
        <li><strong>VAT Identification Number:</strong> DE [Number]</li>
      </ul>
      <p>As required under § 27a of the German Value Added Tax Act (Umsatzsteuergesetz).</p>

      <h2 id="responsible">Responsible Person</h2>
      <p>Responsible for content in accordance with § 18 Abs. 2 MStV:</p>
      <ul>
        <li><strong>Name:</strong> [Managing Director Name]</li>
        <li><strong>Address:</strong> [Same as company address]</li>
      </ul>

      <h2 id="dispute">Dispute Resolution</h2>
      <p>The European Commission provides a platform for online dispute resolution (ODR): <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">https://ec.europa.eu/consumers/odr</a></p>
      <p>We are not willing or obliged to participate in dispute resolution proceedings before a consumer arbitration board.</p>
    </LegalLayout>
  );
}
