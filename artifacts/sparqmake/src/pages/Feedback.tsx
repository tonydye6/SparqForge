import { useState } from "react";
import { MessageSquareText, Send, CheckCircle } from "lucide-react";
import { apiFetch } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

type FeedbackType = "bug" | "feature" | "improvement" | "other";

const FEEDBACK_TYPES: { value: FeedbackType; label: string }[] = [
  { value: "bug", label: "Bug Report" },
  { value: "feature", label: "Feature Request" },
  { value: "improvement", label: "Improvement" },
  { value: "other", label: "Other" },
];

export default function Feedback() {
  const { user } = useAuth();
  const [type, setType] = useState<FeedbackType>("feature");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setSubmitting(true);
    try {
      await apiFetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type, message, userEmail: user?.email }),
      });
    } catch {
    }
    setSubmitted(true);
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center space-y-4">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
          <h2 className="text-2xl font-bold text-foreground">Thank you!</h2>
          <p className="text-muted-foreground max-w-md">
            Your feedback has been received. We appreciate you helping us improve SparqMake.
          </p>
          <button
            onClick={() => {
              setSubmitted(false);
              setMessage("");
            }}
            className="mt-4 px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
          >
            Send More Feedback
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-10 px-6">
      <div className="flex items-center gap-3 mb-8">
        <MessageSquareText className="w-7 h-7 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Feedback</h1>
      </div>

      <p className="text-muted-foreground mb-8">
        Help us improve SparqMake. Share bug reports, feature requests, or general feedback.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Feedback Type
          </label>
          <div className="flex flex-wrap gap-2">
            {FEEDBACK_TYPES.map((ft) => (
              <button
                key={ft.value}
                type="button"
                onClick={() => setType(ft.value)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  type === ft.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/50"
                }`}
              >
                {ft.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Your Message
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe the issue, feature idea, or suggestion..."
            rows={6}
            className="w-full bg-card border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary resize-y"
            required
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !message.trim()}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
          {submitting ? "Sending..." : "Send Feedback"}
        </button>
      </form>
    </div>
  );
}
