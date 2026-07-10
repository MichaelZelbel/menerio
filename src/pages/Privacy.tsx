import { Link } from "react-router-dom";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEOHead } from "@/components/SEOHead";
import { BRAND } from "@/lib/brand";

const Privacy = () => {
  const handlePrint = () => {
    window.print();
  };

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="container py-12 lg:py-16">
      <SEOHead title="Privacy Policy — Menerio" description={`Learn how ${BRAND.name} collects, uses, and protects your personal data.`} />

      <div className="flex flex-col lg:flex-row gap-12">
        {/* Table of Contents Sidebar */}
        <aside className="lg:w-64 flex-shrink-0">
          <div className="lg:sticky lg:top-32">
            <h2 className="text-lg font-semibold text-foreground mb-4">Table of Contents</h2>
            <nav className="space-y-2 text-sm">
              <button
                onClick={() => scrollToSection("interpretation")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                Interpretation and Definitions
              </button>
              <button
                onClick={() => scrollToSection("collecting")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                Collecting and Using Your Personal Data
              </button>
              <button
                onClick={() => scrollToSection("data-processors")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                Third-Party Data Processors
              </button>
              <button
                onClick={() => scrollToSection("children")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                Children's Privacy
              </button>
              <button
                onClick={() => scrollToSection("links")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                Links to Other Websites
              </button>
              <button
                onClick={() => scrollToSection("changes")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                Changes to this Privacy Policy
              </button>
              <button
                onClick={() => scrollToSection("contact")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                Contact Us
              </button>
            </nav>
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 max-w-3xl">
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="text-4xl font-bold text-foreground mb-2">Privacy Policy</h1>
              <p className="text-muted-foreground">
                <strong>Last updated:</strong> December 6, 2025
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="flex items-center gap-2 print:hidden"
            >
              <Printer className="w-4 h-4" />
              Print / Save PDF
            </Button>
          </div>

          <div className="prose prose-sm max-w-none dark:prose-invert space-y-6 text-muted-foreground">
            <p>
              This Privacy Policy describes Our policies and procedures on the collection, use and disclosure of Your information when You use the Service and tells You about Your privacy rights and how the law protects You.
            </p>
            <p>
              We use Your Personal data to provide and improve the Service. By using the Service, You agree to the collection and use of information in accordance with this Privacy Policy.
            </p>

            <section id="interpretation">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Interpretation and Definitions</h2>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Interpretation</h3>
              <p>
                The words of which the initial letter is capitalized have meanings defined under the following conditions. The following definitions shall have the same meaning regardless of whether they appear in singular or in plural.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Definitions</h3>
              <p>For the purposes of this Privacy Policy:</p>
              <ul className="list-disc pl-6 space-y-2 mt-4">
                <li><strong className="text-foreground">Account</strong> means a unique account created for You to access our Service or parts of our Service.</li>
                <li><strong className="text-foreground">Affiliate</strong> means an entity that controls, is controlled by or is under common control with a party, where "control" means ownership of 50% or more of the shares, equity interest or other securities entitled to vote for election of directors or other managing authority.</li>
                <li><strong className="text-foreground">Company</strong> (referred to as either "the Company", "We", "Us" or "Our" in this Agreement) refers to Zelbel Ltd., 69 Great Hampton Street, Birmingham, B18 6EW, United Kingdom.</li>
                <li><strong className="text-foreground">Cookies</strong> are small files that are placed on Your computer, mobile device or any other device by a website, containing the details of Your browsing history on that website among its many uses.</li>
                <li><strong className="text-foreground">Country</strong> refers to: United Kingdom</li>
                <li><strong className="text-foreground">Device</strong> means any device that can access the Service such as a computer, a cellphone or a digital tablet.</li>
                <li><strong className="text-foreground">Personal Data</strong> is any information that relates to an identified or identifiable individual.</li>
                <li><strong className="text-foreground">Service</strong> refers to the Website.</li>
                <li><strong className="text-foreground">Service Provider</strong> means any natural or legal person who processes the data on behalf of the Company. It refers to third-party companies or individuals employed by the Company to facilitate the Service, to provide the Service on behalf of the Company, to perform services related to the Service or to assist the Company in analyzing how the Service is used.</li>
                <li><strong className="text-foreground">Third-party Social Media Service</strong> refers to any website or any social network website through which a User can log in or create an account to use the Service.</li>
                <li><strong className="text-foreground">Usage Data</strong> refers to data collected automatically, either generated by the use of the Service or from the Service infrastructure itself (for example, the duration of a page visit).</li>
                <li><strong className="text-foreground">Website</strong> refers to {BRAND.name}, accessible from {BRAND.url}</li>
                <li><strong className="text-foreground">You</strong> means the individual accessing or using the Service, or the company, or other legal entity on behalf of which such individual is accessing or using the Service, as applicable.</li>
              </ul>
            </section>

            <section id="collecting">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Collecting and Using Your Personal Data</h2>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Types of Data Collected</h3>

              <h4 className="text-lg font-medium text-foreground mt-4 mb-2">Personal Data</h4>
              <p>
                While using Our Service, We may ask You to provide Us with certain personally identifiable information that can be used to contact or identify You. Personally identifiable information may include, but is not limited to:
              </p>
              <ul className="list-disc pl-6 space-y-1 mt-2">
                <li>Email address</li>
                <li>First name and last name</li>
                <li>Usage Data</li>
              </ul>

              <h4 className="text-lg font-medium text-foreground mt-4 mb-2">Usage Data</h4>
              <p>Usage Data is collected automatically when using the Service.</p>
              <p className="mt-2">
                Usage Data may include information such as Your Device's Internet Protocol address (e.g. IP address), browser type, browser version, the pages of our Service that You visit, the time and date of Your visit, the time spent on those pages, unique device identifiers and other diagnostic data.
              </p>
              <p className="mt-2">
                When You access the Service by or through a mobile device, We may collect certain information automatically, including, but not limited to, the type of mobile device You use, Your mobile device unique ID, the IP address of Your mobile device, Your mobile operating system, the type of mobile Internet browser You use, unique device identifiers and other diagnostic data.
              </p>
              <p className="mt-2">
                We may also collect information that Your browser sends whenever You visit our Service or when You access the Service by or through a mobile device.
              </p>

              <h4 className="text-lg font-medium text-foreground mt-4 mb-2">Information from Third-Party Social Media Services</h4>
              <p>
                The Company allows You to create an account and log in to use the Service through Third-party Social Media Services such as Google, Discord, or other providers.
              </p>
              <p className="mt-2">
                If You decide to register through or otherwise grant us access to a Third-Party Social Media Service, We may collect Personal data that is already associated with Your Third-Party Social Media Service's account, such as Your name, Your email address, Your activities or Your contact list associated with that account.
              </p>
              <p className="mt-2">
                You may also have the option of sharing additional information with the Company through Your Third-Party Social Media Service's account. If You choose to provide such information and Personal Data, during registration or otherwise, You are giving the Company permission to use, share, and store it in a manner consistent with this Privacy Policy.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Tracking Technologies and Cookies</h3>
              <p>
                We use Cookies and similar tracking technologies to track the activity on Our Service and store certain information. Tracking technologies used are beacons, tags, and scripts to collect and track information and to improve and analyze Our Service. The technologies We use may include:
              </p>
              <ul className="list-disc pl-6 space-y-2 mt-2">
                <li><strong className="text-foreground">Cookies or Browser Cookies.</strong> A cookie is a small file placed on Your Device. You can instruct Your browser to refuse all Cookies or to indicate when a Cookie is being sent. However, if You do not accept Cookies, You may not be able to use some parts of our Service. Unless you have adjusted Your browser setting so that it will refuse Cookies, our Service may use Cookies.</li>
                <li><strong className="text-foreground">Web Beacons.</strong> Certain sections of our Service and our emails may contain small electronic files known as web beacons (also referred to as clear gifs, pixel tags, and single-pixel gifs) that permit the Company, for example, to count users who have visited those pages or opened an email and for other related website statistics.</li>
              </ul>
              <p className="mt-4">
                Cookies can be "Persistent" or "Session" Cookies. Persistent Cookies remain on Your personal computer or mobile device when You go offline, while Session Cookies are deleted as soon as You close Your web browser.
              </p>
              <p className="mt-2">We use both Session and Persistent Cookies for the purposes set out below:</p>
              <ul className="list-disc pl-6 space-y-4 mt-2">
                <li>
                  <strong className="text-foreground">Necessary / Essential Cookies</strong><br />
                  Type: Session Cookies<br />
                  Administered by: Us<br />
                  Purpose: These Cookies are essential to provide You with services available through the Website and to enable You to use some of its features. They help to authenticate users and prevent fraudulent use of user accounts. Without these Cookies, the services that You have asked for cannot be provided, and We only use these Cookies to provide You with those services.
                </li>
                <li>
                  <strong className="text-foreground">Cookies Policy / Notice Acceptance Cookies</strong><br />
                  Type: Persistent Cookies<br />
                  Administered by: Us<br />
                  Purpose: These Cookies identify if users have accepted the use of cookies on the Website.
                </li>
                <li>
                  <strong className="text-foreground">Functionality Cookies</strong><br />
                  Type: Persistent Cookies<br />
                  Administered by: Us<br />
                  Purpose: These Cookies allow us to remember choices You make when You use the Website, such as remembering your login details or language preference. The purpose of these Cookies is to provide You with a more personal experience and to avoid You having to re-enter your preferences every time You use the Website.
                </li>
              </ul>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Use of Your Personal Data</h3>
              <p>The Company may use Personal Data for the following purposes:</p>
              <ul className="list-disc pl-6 space-y-2 mt-2">
                <li><strong className="text-foreground">To provide and maintain our Service</strong>, including to monitor the usage of our Service.</li>
                <li><strong className="text-foreground">To manage Your Account:</strong> to manage Your registration as a user of the Service. The Personal Data You provide can give You access to different functionalities of the Service that are available to You as a registered user.</li>
                <li><strong className="text-foreground">For the performance of a contract:</strong> the development, compliance and undertaking of the purchase contract for the products, items or services You have purchased or of any other contract with Us through the Service.</li>
                <li><strong className="text-foreground">To contact You:</strong> To contact You by email, telephone calls, SMS, or other equivalent forms of electronic communication, such as a mobile application's push notifications regarding updates or informative communications related to the functionalities, products or contracted services, including the security updates, when necessary or reasonable for their implementation.</li>
                <li><strong className="text-foreground">To provide You</strong> with news, special offers and general information about other goods, services and events which we offer that are similar to those that you have already purchased or enquired about unless You have opted not to receive such information.</li>
                <li><strong className="text-foreground">To manage Your requests:</strong> To attend and manage Your requests to Us.</li>
                <li><strong className="text-foreground">For business transfers:</strong> We may use Your information to evaluate or conduct a merger, divestiture, restructuring, reorganization, dissolution, or other sale or transfer of some or all of Our assets, whether as a going concern or as part of bankruptcy, liquidation, or similar proceeding, in which Personal Data held by Us about our Service users is among the assets transferred.</li>
                <li><strong className="text-foreground">For other purposes:</strong> We may use Your information for other purposes, such as data analysis, identifying usage trends, determining the effectiveness of our promotional campaigns and to evaluate and improve our Service, products, services, marketing and your experience.</li>
              </ul>

              <p className="mt-4">We may share Your personal information in the following situations:</p>
              <ul className="list-disc pl-6 space-y-2 mt-2">
                <li><strong className="text-foreground">With Service Providers:</strong> We may share Your personal information with Service Providers to monitor and analyze the use of our Service, to contact You.</li>
                <li><strong className="text-foreground">For business transfers:</strong> We may share or transfer Your personal information in connection with, or during negotiations of, any merger, sale of Company assets, financing, or acquisition of all or a portion of Our business to another company.</li>
                <li><strong className="text-foreground">With Affiliates:</strong> We may share Your information with Our affiliates, in which case we will require those affiliates to honor this Privacy Policy. Affiliates include Our parent company and any other subsidiaries, joint venture partners or other companies that We control or that are under common control with Us.</li>
                <li><strong className="text-foreground">With business partners:</strong> We may share Your information with Our business partners to offer You certain products, services or promotions.</li>
                <li><strong className="text-foreground">With other users:</strong> when You share personal information or otherwise interact in the public areas with other users, such information may be viewed by all users and may be publicly distributed outside.</li>
                <li><strong className="text-foreground">With Your consent:</strong> We may disclose Your personal information for any other purpose with Your consent.</li>
              </ul>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Retention of Your Personal Data</h3>
              <p>
                The Company will retain Your Personal Data only for as long as is necessary for the purposes set out in this Privacy Policy. We will retain and use Your Personal Data to the extent necessary to comply with our legal obligations (for example, if we are required to retain your data to comply with applicable laws), resolve disputes, and enforce our legal agreements and policies.
              </p>
              <p className="mt-2">
                The Company will also retain Usage Data for internal analysis purposes. Usage Data is generally retained for a shorter period of time, except when this data is used to strengthen the security or to improve the functionality of Our Service, or We are legally obligated to retain this data for longer time periods.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Transfer of Your Personal Data</h3>
              <p>
                Your information, including Personal Data, is processed at the Company's operating offices and in any other places where the parties involved in the processing are located. It means that this information may be transferred to — and maintained on — computers located outside of Your state, province, country or other governmental jurisdiction where the data protection laws may differ than those from Your jurisdiction.
              </p>
              <p className="mt-2">
                Your consent to this Privacy Policy followed by Your submission of such information represents Your agreement to that transfer.
              </p>
              <p className="mt-2">
                The Company will take all steps reasonably necessary to ensure that Your data is treated securely and in accordance with this Privacy Policy and no transfer of Your Personal Data will take place to an organization or a country unless there are adequate controls in place including the security of Your data and other personal information.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Delete Your Personal Data</h3>
              <p>
                You have the right to delete or request that We assist in deleting the Personal Data that We have collected about You.
              </p>
              <p className="mt-2">
                Our Service may give You the ability to delete certain information about You from within the Service.
              </p>
              <p className="mt-2">
                You may update, amend, or delete Your information at any time by signing in to Your Account, if you have one, and visiting the account settings section that allows you to manage Your personal information. You may also contact Us to request access to, correct, or delete any personal information that You have provided to Us.
              </p>
              <p className="mt-2">
                Please note, however, that We may need to retain certain information when we have a legal obligation or lawful basis to do so.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Disclosure of Your Personal Data</h3>

              <h4 className="text-lg font-medium text-foreground mt-4 mb-2">Business Transactions</h4>
              <p>
                If the Company is involved in a merger, acquisition or asset sale, Your Personal Data may be transferred. We will provide notice before Your Personal Data is transferred and becomes subject to a different Privacy Policy.
              </p>

              <h4 className="text-lg font-medium text-foreground mt-4 mb-2">Law enforcement</h4>
              <p>
                Under certain circumstances, the Company may be required to disclose Your Personal Data if required to do so by law or in response to valid requests by public authorities (e.g. a court or a government agency).
              </p>

              <h4 className="text-lg font-medium text-foreground mt-4 mb-2">Other legal requirements</h4>
              <p>The Company may disclose Your Personal Data in the good faith belief that such action is necessary to:</p>
              <ul className="list-disc pl-6 space-y-1 mt-2">
                <li>Comply with a legal obligation</li>
                <li>Protect and defend the rights or property of the Company</li>
                <li>Prevent or investigate possible wrongdoing in connection with the Service</li>
                <li>Protect the personal safety of Users of the Service or the public</li>
                <li>Protect against legal liability</li>
              </ul>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Security of Your Personal Data</h3>
              <p>
                The security of Your Personal Data is important to Us, but remember that no method of transmission over the Internet, or method of electronic storage is 100% secure. While We strive to use commercially acceptable means to protect Your Personal Data, We cannot guarantee its absolute security.
              </p>
            </section>

            <section id="data-processors">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Third-Party Data Processing / Data Processors</h2>
              <p>
                In order to provide and operate the Service, We engage certain third-party service providers ("Data Processors") who process Personal Data on Our behalf. In accordance with Article 28 of the General Data Protection Regulation (GDPR), We have entered into Data Processing Agreements (DPAs) with each of these processors to ensure that Your Personal Data is handled securely, lawfully, and in compliance with applicable data protection legislation.
              </p>
              <p className="mt-2">
                The following is a list of Our current Data Processors, their respective roles, and links to their data protection documentation:
              </p>

              <div className="mt-6 space-y-6">
                <div className="border border-border rounded-lg p-4">
                  <h4 className="text-lg font-medium text-foreground mb-2">Microsoft Azure (including Azure OpenAI Service)</h4>
                  <p className="text-sm"><strong className="text-foreground">Role:</strong> Cloud infrastructure, hosting, and AI inference (Azure OpenAI deployments).</p>
                  <p className="text-sm mt-1">
                    Microsoft acts as a Data Processor under GDPR Article 28 for data processed through its Azure cloud services. AI inference requests processed via Azure OpenAI are subject to Microsoft's data processing commitments and are not used to train or improve Microsoft's models.
                  </p>
                  <p className="text-sm mt-2">
                    <strong className="text-foreground">DPA:</strong>{" "}
                    <a href="https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      Microsoft Products and Services Data Protection Addendum (DPA)
                    </a>
                  </p>
                </div>

                <div className="border border-border rounded-lg p-4">
                  <h4 className="text-lg font-medium text-foreground mb-2">Supabase</h4>
                  <p className="text-sm"><strong className="text-foreground">Role:</strong> Database hosting, authentication, and backend-as-a-service infrastructure.</p>
                  <p className="text-sm mt-1">
                    Supabase acts as a Data Processor under GDPR Article 28 for all user data stored in Our database, including account information, user-generated content, and authentication records.
                  </p>
                  <p className="text-sm mt-2">
                    <strong className="text-foreground">DPA:</strong>{" "}
                    <a href="https://supabase.com/legal/dpa" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      Supabase GDPR Data Processing Addendum
                    </a>
                  </p>
                </div>

                <div className="border border-border rounded-lg p-4">
                  <h4 className="text-lg font-medium text-foreground mb-2">Lovable</h4>
                  <p className="text-sm"><strong className="text-foreground">Role:</strong> Website hosting and deployment platform.</p>
                  <p className="text-sm mt-1">
                    Lovable acts as a Data Processor under GDPR Article 28 for data transmitted through its hosting infrastructure, including HTTP request metadata and deployment-related data.
                  </p>
                  <p className="text-sm mt-2">
                    <strong className="text-foreground">DPA:</strong>{" "}
                    <a href="https://lovable.dev/data-processing-agreement" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      Lovable Data Processing Agreement
                    </a>
                  </p>
                </div>

                <div className="border border-border rounded-lg p-4">
                  <h4 className="text-lg font-medium text-foreground mb-2">Hostinger</h4>
                  <p className="text-sm"><strong className="text-foreground">Role:</strong> Domain registration and DNS management.</p>
                  <p className="text-sm mt-1">
                    Hostinger acts as a Data Processor under GDPR Article 28 for domain-related data and DNS query metadata processed through its infrastructure.
                  </p>
                  <p className="text-sm mt-2">
                    <strong className="text-foreground">DPA:</strong>{" "}
                    <a href="https://www.hostinger.com/legal/dpa" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      Hostinger Data Processing Agreement
                    </a>
                  </p>
                </div>

                <div className="border border-border rounded-lg p-4">
                  <h4 className="text-lg font-medium text-foreground mb-2">Resend</h4>
                  <p className="text-sm"><strong className="text-foreground">Role:</strong> Transactional email delivery service.</p>
                  <p className="text-sm mt-1">
                    Resend acts as a Data Processor under GDPR Article 28 for Personal Data included in transactional emails sent on Our behalf, such as email addresses and message content.
                  </p>
                  <p className="text-sm mt-2">
                    <strong className="text-foreground">DPA:</strong>{" "}
                    <a href="https://resend.com/legal/dpa" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      Resend Data Processing Agreement
                    </a>
                  </p>
                </div>

                <div className="border border-border rounded-lg p-4">
                  <h4 className="text-lg font-medium text-foreground mb-2">OpenAI</h4>
                  <p className="text-sm"><strong className="text-foreground">Role:</strong> AI inference provider (fallback for certain AI-powered features).</p>
                  <p className="text-sm mt-1">
                    Where OpenAI services are used as a fallback for AI inference, OpenAI acts as a Data Processor under GDPR Article 28. Data submitted via the OpenAI API is processed in accordance with OpenAI's enterprise data processing terms and is not used to train OpenAI's models.
                  </p>
                  <p className="text-sm mt-2">
                    <strong className="text-foreground">DPA:</strong>{" "}
                    <a href="https://openai.com/policies/data-processing-addendum" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      OpenAI Data Processing Addendum
                    </a>
                  </p>
                </div>

                <div className="border border-border rounded-lg p-4">
                  <h4 className="text-lg font-medium text-foreground mb-2">OpenRouter</h4>
                  <p className="text-sm"><strong className="text-foreground">Role:</strong> AI inference routing provider (multi-model API gateway).</p>
                  <p className="text-sm mt-1">
                    OpenRouter acts as a Data Processor under GDPR Article 28 for data processed through its AI inference routing API. Data submitted via the OpenRouter API is processed in accordance with OpenRouter's data processing commitments and is routed to upstream model providers according to their respective data handling policies.
                  </p>
                  <p className="text-sm mt-2">
                    <strong className="text-foreground">DPA:</strong>{" "}
                    <a href="https://trust.openrouter.ai/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      OpenRouter Trust &amp; Data Protection
                    </a>
                  </p>
                </div>

                <div className="border border-border rounded-lg p-4">
                  <h4 className="text-lg font-medium text-foreground mb-2">n8n</h4>
                  <p className="text-sm"><strong className="text-foreground">Role:</strong> Workflow automation and AI orchestration platform.</p>
                  <p className="text-sm mt-1">
                    n8n acts as a Data Processor under GDPR Article 28 for data processed through automated workflows, including AI inference orchestration, webhook payloads, and integration data flows.
                  </p>
                  <p className="text-sm mt-2">
                    <strong className="text-foreground">DPA:</strong>{" "}
                    <a href="https://n8n.io/legal/data-processing-agreement/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      n8n Data Processing Agreement
                    </a>
                  </p>
                </div>
              </div>

              <p className="mt-6">
                We regularly review the data protection practices of Our Data Processors and ensure that appropriate technical and organisational measures are in place to safeguard Your Personal Data. If You have any questions about Our use of Data Processors, please contact Us at{" "}
                <a href={`mailto:${BRAND.supportEmail}`} className="text-primary hover:underline">{BRAND.supportEmail}</a>.
              </p>
            </section>

            <section id="children">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Children's Privacy</h2>
              <p>
                Our Service does not address anyone under the age of 13. We do not knowingly collect personally identifiable information from anyone under the age of 13. If You are a parent or guardian and You are aware that Your child has provided Us with Personal Data, please contact Us. If We become aware that We have collected Personal Data from anyone under the age of 13 without verification of parental consent, We take steps to remove that information from Our servers.
              </p>
              <p className="mt-2">
                If We need to rely on consent as a legal basis for processing Your information and Your country requires consent from a parent, We may require Your parent's consent before We collect and use that information.
              </p>
            </section>

            <section id="links">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Links to Other Websites</h2>
              <p>
                Our Service may contain links to other websites that are not operated by Us. If You click on a third party link, You will be directed to that third party's site. We strongly advise You to review the Privacy Policy of every site You visit.
              </p>
              <p className="mt-2">
                We have no control over and assume no responsibility for the content, privacy policies or practices of any third party sites or services.
              </p>
            </section>

            <section id="changes">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Changes to this Privacy Policy</h2>
              <p>
                We may update Our Privacy Policy from time to time. We will notify You of any changes by posting the new Privacy Policy on this page.
              </p>
              <p className="mt-2">
                We will let You know via email and/or a prominent notice on Our Service, prior to the change becoming effective and update the "Last updated" date at the top of this Privacy Policy.
              </p>
              <p className="mt-2">
                You are advised to review this Privacy Policy periodically for any changes. Changes to this Privacy Policy are effective when they are posted on this page.
              </p>
            </section>

            <section id="contact">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Contact Us</h2>
              <p>If you have any questions about this Privacy Policy, You can contact us:</p>
              <ul className="list-disc pl-6 mt-2">
                <li>By email: <a href={`mailto:${BRAND.supportEmail}`} className="text-primary hover:underline">{BRAND.supportEmail}</a></li>
              </ul>
            </section>

            <div className="mt-10 pt-6 border-t border-border">
              <p className="text-sm">
                See also: <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link> | <Link to="/cookies" className="text-primary hover:underline">Cookies Policy</Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Privacy;
