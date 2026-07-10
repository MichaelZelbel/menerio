import { Link } from "react-router-dom";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEOHead } from "@/components/SEOHead";
import { BRAND } from "@/lib/brand";

const Terms = () => {
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
      <SEOHead title="Terms of Service — Menerio" description={`Read ${BRAND.name}'s Terms of Service covering account usage, content ownership, subscriptions, acceptable use, and your rights as a user.`} />

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
                onClick={() => scrollToSection("acknowledgment")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                Acknowledgment
              </button>
              <button
                onClick={() => scrollToSection("links")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                Links to Other Websites
              </button>
              <button
                onClick={() => scrollToSection("termination")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                Termination
              </button>
              <button
                onClick={() => scrollToSection("withdrawal")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                Right of Withdrawal (Widerrufsrecht)
              </button>
              <button
                onClick={() => scrollToSection("liability")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                Limitation of Liability
              </button>
              <button
                onClick={() => scrollToSection("disclaimer")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                "AS IS" Disclaimer
              </button>
              <button
                onClick={() => scrollToSection("governing")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                Governing Law
              </button>
              <button
                onClick={() => scrollToSection("changes")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                Changes to These Terms
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
              <h1 className="text-4xl font-bold text-foreground mb-2">Terms of Service</h1>
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
              Please read these terms and conditions carefully before using Our Service.
            </p>

            <section id="interpretation">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Interpretation and Definitions</h2>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Interpretation</h3>
              <p>
                The words of which the initial letter is capitalized have meanings defined under the following conditions. The following definitions shall have the same meaning regardless of whether they appear in singular or in plural.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Definitions</h3>
              <p>For the purposes of these Terms and Conditions:</p>
              <ul className="list-disc pl-6 space-y-2 mt-4">
                <li><strong className="text-foreground">Affiliate</strong> means an entity that controls, is controlled by or is under common control with a party, where "control" means ownership of 50% or more of the shares, equity interest or other securities entitled to vote for election of directors or other managing authority.</li>
                <li><strong className="text-foreground">Country</strong> refers to: United Kingdom</li>
                <li><strong className="text-foreground">Company</strong> (referred to as either "the Company", "We", "Us" or "Our" in this Agreement) refers to Zelbel Ltd., 69 Great Hampton Street Birmingham, B18 6EW United Kingdom.</li>
                <li><strong className="text-foreground">Device</strong> means any device that can access the Service such as a computer, a cellphone or a digital tablet.</li>
                <li><strong className="text-foreground">Service</strong> refers to the Website.</li>
                <li><strong className="text-foreground">Terms and Conditions</strong> (also referred as "Terms") mean these Terms and Conditions that form the entire agreement between You and the Company regarding the use of the Service.</li>
                <li><strong className="text-foreground">Third-party Social Media Service</strong> means any services or content (including data, information, products or services) provided by a third-party that may be displayed, included or made available by the Service.</li>
                <li><strong className="text-foreground">Website</strong> refers to {BRAND.name}, accessible from {BRAND.url}</li>
                <li><strong className="text-foreground">You</strong> means the individual accessing or using the Service, or the company, or other legal entity on behalf of which such individual is accessing or using the Service, as applicable.</li>
              </ul>
            </section>

            <section id="acknowledgment">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Acknowledgment</h2>
              <p>
                These are the Terms and Conditions governing the use of this Service and the agreement that operates between You and the Company. These Terms and Conditions set out the rights and obligations of all users regarding the use of the Service.
              </p>
              <p className="mt-2">
                Your access to and use of the Service is conditioned on Your acceptance of and compliance with these Terms and Conditions. These Terms and Conditions apply to all visitors, users and others who access or use the Service.
              </p>
              <p className="mt-2">
                By accessing or using the Service You agree to be bound by these Terms and Conditions. If You disagree with any part of these Terms and Conditions then You may not access the Service.
              </p>
              <p className="mt-2">
                You represent that you are over the age of 18. The Company does not permit those under 18 to use the Service.
              </p>
              <p className="mt-2">
                Your access to and use of the Service is also conditioned on Your acceptance of and compliance with the Privacy Policy of the Company. Our Privacy Policy describes Our policies and procedures on the collection, use and disclosure of Your personal information when You use the Application or the Website and tells You about Your privacy rights and how the law protects You. Please read Our Privacy Policy carefully before using Our Service.
              </p>
            </section>

            <section id="links">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Links to Other Websites</h2>
              <p>
                Our Service may contain links to third-party web sites or services that are not owned or controlled by the Company.
              </p>
              <p className="mt-2">
                The Company has no control over, and assumes no responsibility for, the content, privacy policies, or practices of any third party web sites or services. You further acknowledge and agree that the Company shall not be responsible or liable, directly or indirectly, for any damage or loss caused or alleged to be caused by or in connection with the use of or reliance on any such content, goods or services available on or through any such web sites or services.
              </p>
              <p className="mt-2">
                We strongly advise You to read the terms and conditions and privacy policies of any third-party web sites or services that You visit.
              </p>
            </section>

            <section id="termination">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Termination</h2>
              <p>
                We may terminate or suspend Your access immediately, without prior notice or liability, for any reason whatsoever, including without limitation if You breach these Terms and Conditions.
              </p>
              <p className="mt-2">
                Upon termination, Your right to use the Service will cease immediately.
              </p>
            </section>

            <section id="withdrawal">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Right of Withdrawal (Widerrufsbelehrung)</h2>
              <p className="font-medium text-foreground">
                Information on the Right of Withdrawal for Consumers in the European Union
              </p>
              
              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Right of Withdrawal</h3>
              <p>
                You have the right to withdraw from this contract within 14 days without giving any reason.
              </p>
              <p className="mt-2">
                The withdrawal period will expire after 14 days from the day of the conclusion of the contract.
              </p>
              <p className="mt-2">
                To exercise the right of withdrawal, you must inform us (Zelbel Ltd., 69 Great Hampton Street, Birmingham, B18 6EW, United Kingdom, Email: {BRAND.supportEmail}) of your decision to withdraw from this contract by an unequivocal statement (e.g., a letter sent by post or email). You may use the model withdrawal form below, but it is not obligatory.
              </p>
              <p className="mt-2">
                To meet the withdrawal deadline, it is sufficient for you to send your communication concerning your exercise of the right of withdrawal before the withdrawal period has expired.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Effects of Withdrawal</h3>
              <p>
                If you withdraw from this contract, we shall reimburse to you all payments received from you, including the costs of delivery (with the exception of the supplementary costs resulting from your choice of a type of delivery other than the least expensive type of standard delivery offered by us), without undue delay and in any event not later than 14 days from the day on which we are informed about your decision to withdraw from this contract. We will carry out such reimbursement using the same means of payment as you used for the initial transaction, unless you have expressly agreed otherwise; in any event, you will not incur any fees as a result of such reimbursement.
              </p>
              <p className="mt-2">
                If you requested to begin the performance of services during the withdrawal period, you shall pay us an amount which is in proportion to what has been provided until you have communicated to us your withdrawal from this contract, in comparison with the full coverage of the contract.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Exclusion of the Right of Withdrawal</h3>
              <p>
                The right of withdrawal does not apply to:
              </p>
              <ul className="list-disc pl-6 space-y-2 mt-2">
                <li>Contracts for the supply of digital content which is not supplied on a tangible medium if the performance has begun with your prior express consent and your acknowledgment that you thereby lose your right of withdrawal.</li>
                <li>Contracts for the supply of services if the service has been fully performed by us and the performance has begun with your prior express consent and your acknowledgment that you would lose your right of withdrawal once the contract had been fully performed by us.</li>
              </ul>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Model Withdrawal Form</h3>
              <p className="text-sm italic">
                (Complete and return this form only if you wish to withdraw from the contract)
              </p>
              <div className="mt-2 p-4 bg-muted/30 rounded-lg border border-border">
                <p>To: Zelbel Ltd., 69 Great Hampton Street, Birmingham, B18 6EW, United Kingdom</p>
                <p>Email: {BRAND.supportEmail}</p>
                <p className="mt-2">I/We (*) hereby give notice that I/We (*) withdraw from my/our (*) contract for the provision of the following service (*):</p>
                <p className="mt-2">— Ordered on (*) / received on (*):</p>
                <p>— Name of consumer(s):</p>
                <p>— Address of consumer(s):</p>
                <p>— Signature of consumer(s) (only if this form is notified on paper):</p>
                <p>— Date:</p>
                <p className="mt-2 text-sm">(*) Delete as appropriate.</p>
              </div>
            </section>

            <section id="liability">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Limitation of Liability</h2>
              <p>
                Notwithstanding any damages that You might incur, the entire liability of the Company and any of its suppliers under any provision of this Terms and Your exclusive remedy for all of the foregoing shall be limited to the amount actually paid by You through the Service or 100 USD if You haven't purchased anything through the Service.
              </p>
              <p className="mt-2">
                To the maximum extent permitted by applicable law, in no event shall the Company or its suppliers be liable for any special, incidental, indirect, or consequential damages whatsoever (including, but not limited to, damages for loss of profits, loss of data or other information, for business interruption, for personal injury, loss of privacy arising out of or in any way related to the use of or inability to use the Service, third-party software and/or third-party hardware used with the Service, or otherwise in connection with any provision of this Terms), even if the Company or any supplier has been advised of the possibility of such damages and even if the remedy fails of its essential purpose.
              </p>
              <p className="mt-2">
                Some states do not allow the exclusion of implied warranties or limitation of liability for incidental or consequential damages, which means that some of the above limitations may not apply. In these states, each party's liability will be limited to the greatest extent permitted by law.
              </p>
            </section>

            <section id="disclaimer">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">"AS IS" and "AS AVAILABLE" Disclaimer</h2>
              <p>
                The Service is provided to You "AS IS" and "AS AVAILABLE" and with all faults and defects without warranty of any kind. To the maximum extent permitted under applicable law, the Company, on its own behalf and on behalf of its Affiliates and its and their respective licensors and service providers, expressly disclaims all warranties, whether express, implied, statutory or otherwise, with respect to the Service, including all implied warranties of merchantability, fitness for a particular purpose, title and non-infringement, and warranties that may arise out of course of dealing, course of performance, usage or trade practice. Without limitation to the foregoing, the Company provides no warranty or undertaking, and makes no representation of any kind that the Service will meet Your requirements, achieve any intended results, be compatible or work with any other software, applications, systems or services, operate without interruption, meet any performance or reliability standards or be error free or that any errors or defects can or will be corrected.
              </p>
              <p className="mt-2">
                Without limiting the foregoing, neither the Company nor any of the company's provider makes any representation or warranty of any kind, express or implied: (i) as to the operation or availability of the Service, or the information, content, and materials or products included thereon; (ii) that the Service will be uninterrupted or error-free; (iii) as to the accuracy, reliability, or currency of any information or content provided through the Service; or (iv) that the Service, its servers, the content, or e-mails sent from or on behalf of the Company are free of viruses, scripts, trojan horses, worms, malware, timebombs or other harmful components.
              </p>
              <p className="mt-2">
                Some jurisdictions do not allow the exclusion of certain types of warranties or limitations on applicable statutory rights of a consumer, so some or all of the above exclusions and limitations may not apply to You. But in such a case the exclusions and limitations set forth in this section shall be applied to the greatest extent enforceable under applicable law.
              </p>
            </section>

            <section id="governing">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Governing Law</h2>
              <p>
                The laws of the Country, excluding its conflicts of law rules, shall govern this Terms and Your use of the Service. Your use of the Application may also be subject to other local, state, national, or international laws.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Disputes Resolution</h3>
              <p>
                If You have any concern or dispute about the Service, You agree to first try to resolve the dispute informally by contacting the Company.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">For European Union (EU) Users</h3>
              <p>
                If You are a European Union consumer, you will benefit from any mandatory provisions of the law of the country in which You are resident.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">United States Legal Compliance</h3>
              <p>
                You represent and warrant that (i) You are not located in a country that is subject to the United States government embargo, or that has been designated by the United States government as a "terrorist supporting" country, and (ii) You are not listed on any United States government list of prohibited or restricted parties.
              </p>
            </section>

            <section id="severability">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Severability and Waiver</h2>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Severability</h3>
              <p>
                If any provision of these Terms is held to be unenforceable or invalid, such provision will be changed and interpreted to accomplish the objectives of such provision to the greatest extent possible under applicable law and the remaining provisions will continue in full force and effect.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Waiver</h3>
              <p>
                Except as provided herein, the failure to exercise a right or to require performance of an obligation under these Terms shall not affect a party's ability to exercise such right or require such performance at any time thereafter nor shall the waiver of a breach constitute a waiver of any subsequent breach.
              </p>
            </section>

            <section id="translation">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Translation Interpretation</h2>
              <p>
                These Terms and Conditions may have been translated if We have made them available to You on our Service. You agree that the original English text shall prevail in the case of a dispute.
              </p>
            </section>

            <section id="changes">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Changes to These Terms and Conditions</h2>
              <p>
                We reserve the right, at Our sole discretion, to modify or replace these Terms at any time. If a revision is material We will make reasonable efforts to provide at least 30 days' notice prior to any new terms taking effect. What constitutes a material change will be determined at Our sole discretion.
              </p>
              <p className="mt-2">
                By continuing to access or use Our Service after those revisions become effective, You agree to be bound by the revised terms. If You do not agree to the new terms, in whole or in part, please stop using the website and the Service.
              </p>
            </section>

            <section id="contact">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Contact Us</h2>
              <p>If you have any questions about these Terms and Conditions, You can contact us:</p>
              <ul className="list-disc pl-6 mt-2">
                <li>By email: <a href={`mailto:${BRAND.supportEmail}`} className="text-primary hover:underline">{BRAND.supportEmail}</a></li>
              </ul>
            </section>

            <div className="mt-10 pt-6 border-t border-border">
              <p className="text-sm">
                See also: <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link> | <Link to="/cookies" className="text-primary hover:underline">Cookies Policy</Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Terms;
