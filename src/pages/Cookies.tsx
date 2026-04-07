import { Link } from "react-router-dom";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEOHead } from "@/components/SEOHead";

const Cookies = () => {
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
      <SEOHead title="Cookies Policy — Menerio" description="Learn how Menerio uses cookies on its website." />

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
                onClick={() => scrollToSection("use")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                The Use of Cookies
              </button>
              <button
                onClick={() => scrollToSection("choices")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                Your Choices Regarding Cookies
              </button>
              <button
                onClick={() => scrollToSection("more")}
                className="block text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                More Information
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
              <h1 className="text-4xl font-bold text-foreground mb-2">Cookies Policy</h1>
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
              This Cookies Policy explains what Cookies are and how We use them. You should read this policy so You can understand what type of cookies We use, or the information We collect using Cookies and how that information is used.
            </p>
            <p>
              Cookies do not typically contain any information that personally identifies a user, but personal information that we store about You may be linked to the information stored in and obtained from Cookies. For further information on how We use, store and keep your personal data secure, see our <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
            </p>
            <p>
              We do not store sensitive personal information, such as mailing addresses, account passwords, etc. in the Cookies We use.
            </p>

            <section id="interpretation">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Interpretation and Definitions</h2>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Interpretation</h3>
              <p>
                The words of which the initial letter is capitalized have meanings defined under the following conditions. The following definitions shall have the same meaning regardless of whether they appear in singular or in plural.
              </p>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Definitions</h3>
              <p>For the purposes of this Cookies Policy:</p>
              <ul className="list-disc pl-6 space-y-2 mt-4">
                <li><strong className="text-foreground">Company</strong> (referred to as either "the Company", "We", "Us" or "Our" in this Cookies Policy) refers to Zelbel Ltd., 69 Great Hampton Street Birmingham, B18 6EW United Kingdom.</li>
                <li><strong className="text-foreground">Cookies</strong> means small files that are placed on Your computer, mobile device or any other device by a website, containing details of your browsing history on that website among its many uses.</li>
                <li><strong className="text-foreground">Website</strong> refers to Menerio, accessible from https://menerio.com</li>
                <li><strong className="text-foreground">You</strong> means the individual accessing or using the Website, or a company, or any legal entity on behalf of which such individual is accessing or using the Website, as applicable.</li>
              </ul>
            </section>

            <section id="use">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">The Use of Cookies</h2>

              <h3 className="text-xl font-medium text-foreground mt-6 mb-3">Type of Cookies We Use</h3>
              <p>
                Cookies can be "Persistent" or "Session" Cookies. Persistent Cookies remain on your personal computer or mobile device when You go offline, while Session Cookies are deleted as soon as You close your web browser.
              </p>
              <p className="mt-2">
                We use both session and persistent Cookies for the purposes set out below:
              </p>

              <ul className="list-disc pl-6 space-y-4 mt-4">
                <li>
                  <strong className="text-foreground">Necessary / Essential Cookies</strong><br />
                  Type: Session Cookies<br />
                  Administered by: Us<br />
                  Purpose: These Cookies are essential to provide You with services available through the Website and to enable You to use some of its features. They help to authenticate users and prevent fraudulent use of user accounts. Without these Cookies, the services that You have asked for cannot be provided, and We only use these Cookies to provide You with those services.
                </li>
                <li>
                  <strong className="text-foreground">Functionality Cookies</strong><br />
                  Type: Persistent Cookies<br />
                  Administered by: Us<br />
                  Purpose: These Cookies allow us to remember choices You make when You use the Website, such as remembering your login details or language preference. The purpose of these Cookies is to provide You with a more personal experience and to avoid You having to re-enter your preferences every time You use the Website.
                </li>
              </ul>
            </section>

            <section id="choices">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Your Choices Regarding Cookies</h2>
              <p>
                If You prefer to avoid the use of Cookies on the Website, first You must disable the use of Cookies in your browser and then delete the Cookies saved in your browser associated with this website. You may use this option for preventing the use of Cookies at any time.
              </p>
              <p className="mt-2">
                If You do not accept Our Cookies, You may experience some inconvenience in your use of the Website and some features may not function properly.
              </p>
              <p className="mt-2">
                If You'd like to delete Cookies or instruct your web browser to delete or refuse Cookies, please visit the help pages of your web browser.
              </p>
              <ul className="list-disc pl-6 space-y-2 mt-4">
                <li>
                  For the <strong className="text-foreground">Chrome</strong> web browser, please visit this page from Google:{" "}
                  <a href="https://support.google.com/accounts/answer/32050" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    https://support.google.com/accounts/answer/32050
                  </a>
                </li>
                <li>
                  For the <strong className="text-foreground">Internet Explorer</strong> web browser, please visit this page from Microsoft:{" "}
                  <a href="http://support.microsoft.com/kb/278835" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    http://support.microsoft.com/kb/278835
                  </a>
                </li>
                <li>
                  For the <strong className="text-foreground">Firefox</strong> web browser, please visit this page from Mozilla:{" "}
                  <a href="https://support.mozilla.org/en-US/kb/delete-cookies-remove-info-websites-stored" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    https://support.mozilla.org/en-US/kb/delete-cookies-remove-info-websites-stored
                  </a>
                </li>
                <li>
                  For the <strong className="text-foreground">Safari</strong> web browser, please visit this page from Apple:{" "}
                  <a href="https://support.apple.com/guide/safari/manage-cookies-and-website-data-sfri11471/mac" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    https://support.apple.com/guide/safari/manage-cookies-and-website-data-sfri11471/mac
                  </a>
                </li>
                <li>
                  For any other web browser, please visit your web browser's official web pages.
                </li>
              </ul>
            </section>

            <section id="more">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">More Information about Cookies</h2>
              <p>
                You can learn more about cookies:{" "}
                <a href="https://www.allaboutcookies.org/what-are-cookies/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  What Are Cookies?
                </a>
              </p>
            </section>

            <section id="contact">
              <h2 className="text-2xl font-semibold text-foreground mt-10 mb-4">Contact Us</h2>
              <p>If you have any questions about this Cookies Policy, You can contact us:</p>
              <ul className="list-disc pl-6 mt-2">
                <li>By email: <a href="mailto:support@menerio.com" className="text-primary hover:underline">support@menerio.com</a></li>
              </ul>
            </section>

            <div className="mt-10 pt-6 border-t border-border">
              <p className="text-sm">
                See also: <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link> | <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Cookies;
