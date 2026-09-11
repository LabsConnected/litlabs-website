"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

const FAQS = [
  {
    question: "Is LiTT just another AI chatbot?",
    answer:
      "No. LiTT is designed around persistent projects, real files, tools, workflows, and verification. A chatbot gives you text in a conversation. LiTT creates and edits actual project files, runs tools, manages context across sessions, and prepares work for deployment.",
  },
  {
    question: "Do I need to know how to code?",
    answer:
      "No. You describe what you want in plain language and LiTT handles the code, files, and tool execution. You review the results and approve sensitive actions. Coding knowledge helps you review and direct the work, but it is not required to start.",
  },
  {
    question: "Can I use an existing GitHub project?",
    answer:
      "Yes. You can connect a GitHub repository and LiTT works directly on your project files. GitHub connection is available on Creator Beta and Pro Builder Beta plans.",
  },
  {
    question: "Who owns the code and assets LiTT creates?",
    answer:
      "You do. Files and generated assets remain in your workspace and are exportable. LiTT does not claim ownership of your work. You can download your project files at any time.",
  },
  {
    question: "Can LiTT deploy automatically?",
    answer:
      "No. LiTT prepares deployment but does not deploy without your explicit approval. Sensitive actions—including deployment—require your confirmation before proceeding. Deploy is currently in Beta.",
  },
  {
    question: "Can I review changes before they happen?",
    answer:
      "Yes. LiTT shows you what it plans to do, and sensitive actions stop for your approval. You can inspect diffs, review proposed changes, and approve or reject before LiTT proceeds. Project checkpoints let you recover earlier states.",
  },
  {
    question: "Is LiTT free?",
    answer:
      "Yes. The Starter plan is free forever with 500 AI credits and 1 active project—no credit card required. Paid plans unlock more projects, credits, and advanced features. See pricing for details.",
  },
  {
    question: "What can LiTT build?",
    answer:
      "LiTT can build websites, apps, dashboards, landing pages, creative assets (images, audio, copy), and internal tools. It coordinates planning, code, file editing, tool execution, testing, and deployment preparation. Voice, Terminal, and Deploy are currently in Beta.",
  },
];

export function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="litt-section relative overflow-hidden border-t border-white/8">
      <div className="litt-grid-fade pointer-events-none absolute inset-0 opacity-20" />
      <div className="relative mx-auto max-w-3xl px-5 lg:px-8">
        <div data-reveal className="text-center">
          <div className="litt-eyebrow">
            <ChevronDown size={13} /> Common questions
          </div>
          <h2 className="mt-5 text-[clamp(2.25rem,5vw,4.75rem)] font-black leading-[0.98] tracking-[-0.055em] text-white">
            Answers before <span className="litt-gradient-text">you have to ask.</span>
          </h2>
        </div>

        <div data-reveal className="mt-10 space-y-3">
          {FAQS.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={faq.question}
                className={`litt-faq-item ${isOpen ? "is-open" : ""}`}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${index}`}
                  id={`faq-trigger-${index}`}
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6"
                >
                  <span className="text-sm font-black text-white sm:text-base">{faq.question}</span>
                  <ChevronDown
                    size={18}
                    className={`shrink-0 text-white/40 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {isOpen && (
                  <div
                    id={`faq-panel-${index}`}
                    role="region"
                    aria-labelledby={`faq-trigger-${index}`}
                    className="px-5 pb-5 sm:px-6"
                  >
                    <p className="text-sm leading-7 text-white/52">{faq.answer}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
