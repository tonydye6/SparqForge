export default function Privacy() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] text-gray-300 px-6 py-12">
      <div className="max-w-3xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
          <p className="text-sm text-gray-500">Last updated: March 27, 2026</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">1. Introduction</h2>
          <p>
            This Privacy Policy explains how SparqForge, operated by Sparq Games ("we", "us", "our"), collects,
            uses, and protects your information when you use our AI-powered social media content management platform.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">2. Information We Collect</h2>
          <h3 className="text-lg font-medium text-gray-200">Account Information</h3>
          <p>
            When you create an account, we collect your username, display name, and profile image through Replit
            authentication.
          </p>
          <h3 className="text-lg font-medium text-gray-200">Connected Social Media Accounts</h3>
          <p>
            When you connect social media platforms (TikTok, YouTube, Twitter/X, Instagram, LinkedIn), we store
            OAuth access tokens to publish content on your behalf. We access only the permissions you explicitly
            grant during the authorization process.
          </p>
          <h3 className="text-lg font-medium text-gray-200">Content Data</h3>
          <p>
            We store the content you create, including text captions, images, videos, and scheduling information.
            AI-generated content is processed through third-party AI services.
          </p>
          <h3 className="text-lg font-medium text-gray-200">Usage Data</h3>
          <p>
            We collect basic usage data such as content creation activity, publishing history, and cost tracking
            to provide and improve the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">3. How We Use Your Information</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>To provide the content creation and publishing services</li>
            <li>To publish content to your connected social media accounts on your behalf</li>
            <li>To generate AI-powered content based on your brand settings and preferences</li>
            <li>To schedule and manage your content calendar</li>
            <li>To track usage costs and provide cost dashboard insights</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">4. Third-Party Services</h2>
          <p>We integrate with the following third-party services:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>TikTok</strong> — Content publishing via TikTok Content Posting API</li>
            <li><strong>YouTube</strong> — Video publishing via YouTube Data API v3</li>
            <li><strong>Twitter/X</strong> — Content publishing via Twitter API</li>
            <li><strong>Instagram</strong> — Content publishing via Instagram Graph API</li>
            <li><strong>LinkedIn</strong> — Content publishing via LinkedIn API</li>
            <li><strong>AI Services</strong> — Content generation via Anthropic, Google Gemini, and ElevenLabs</li>
          </ul>
          <p>
            Each third-party service has its own privacy policy. We encourage you to review them.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">5. Data Storage and Security</h2>
          <p>
            Your data is stored in a PostgreSQL database hosted on Replit. OAuth tokens are stored securely and
            used only to perform authorized actions on your connected accounts. We use HTTPS for all data
            transmission.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">6. Data Sharing</h2>
          <p>
            We do not sell, trade, or rent your personal information to third parties. We share data only as
            necessary to provide the Service (e.g., publishing content to the platforms you've connected).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">7. Your Rights</h2>
          <p>You have the right to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Disconnect any linked social media account at any time</li>
            <li>Delete your content and data from SparqForge</li>
            <li>Request information about what data we store about you</li>
            <li>Revoke platform permissions through each social media platform's settings</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">8. Data Retention</h2>
          <p>
            We retain your data for as long as your account is active. If you disconnect a social media account,
            we delete the associated OAuth tokens. Content data is retained until you delete it or close your
            account.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">9. Children's Privacy</h2>
          <p>
            The Service is not intended for children under the age of 13. We do not knowingly collect personal
            information from children.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any changes by updating
            the "Last updated" date at the top of this page.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">11. Contact Us</h2>
          <p>
            For questions about this Privacy Policy, contact us at{" "}
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
