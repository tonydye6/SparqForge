export default function Terms() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] text-gray-300 px-6 py-12">
      <div className="max-w-3xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Terms of Service</h1>
          <p className="text-sm text-gray-500">Last updated: March 27, 2026</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">1. Acceptance of Terms</h2>
          <p>
            By accessing or using SparqForge ("the Service"), operated by Sparq Games, you agree to be bound by these
            Terms of Service. If you do not agree, do not use the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">2. Description of Service</h2>
          <p>
            SparqForge is an AI-powered social media content management platform that helps gaming brands create,
            schedule, and publish content across multiple social media platforms including Twitter/X, Instagram,
            LinkedIn, TikTok, and YouTube.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">3. User Accounts</h2>
          <p>
            You are responsible for maintaining the confidentiality of your account credentials and for all activities
            that occur under your account. You must notify us immediately of any unauthorized use.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">4. Connected Social Media Accounts</h2>
          <p>
            By connecting third-party social media accounts (TikTok, YouTube, Twitter/X, Instagram, LinkedIn), you
            authorize SparqForge to publish content on your behalf to those platforms. You may revoke access at any
            time through the Settings page or through the respective platform's account settings.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">5. Content Ownership</h2>
          <p>
            You retain all ownership rights to the content you create, upload, or publish through SparqForge.
            AI-generated content produced by the Service is provided for your use and you are responsible for
            ensuring it complies with applicable laws and platform policies.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">6. Acceptable Use</h2>
          <p>You agree not to use the Service to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Violate any applicable laws or regulations</li>
            <li>Publish content that is illegal, harmful, or violates third-party rights</li>
            <li>Interfere with or disrupt the Service or its infrastructure</li>
            <li>Attempt to gain unauthorized access to other accounts or systems</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">7. Limitation of Liability</h2>
          <p>
            The Service is provided "as is" without warranties of any kind. Sparq Games shall not be liable for any
            indirect, incidental, special, or consequential damages arising from your use of the Service, including
            but not limited to content publishing failures or social media account issues.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">8. Termination</h2>
          <p>
            We reserve the right to suspend or terminate your access to the Service at any time for violation of
            these terms. Upon termination, your right to use the Service ceases immediately.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">9. Changes to Terms</h2>
          <p>
            We may update these Terms from time to time. Continued use of the Service after changes constitutes
            acceptance of the updated terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">10. Contact</h2>
          <p>
            For questions about these Terms, contact us at{" "}
            <a href="mailto:support@sparqgames.com" className="text-blue-400 hover:text-blue-300 underline">
              support@sparqgames.com
            </a>.
          </p>
        </section>

        <div className="pt-8 border-t border-gray-800">
          <a href="/" className="text-blue-400 hover:text-blue-300 text-sm">&larr; Back to SparqForge</a>
        </div>
      </div>
    </div>
  );
}
