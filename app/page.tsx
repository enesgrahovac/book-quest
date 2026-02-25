import Link from "next/link";

const features = [
  "Create courses from PDFs or from scratch with AI",
  "Unlock-based progression through lessons and assessments",
  "Adaptive reinforcement of weak concepts",
  "Editable markdown state files per learner (SOUL, PROFILE, PREFERENCES, MEMORY)",
  "Tutor character chosen during onboarding"
];

export default function HomePage() {
  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">Book Quest</p>
        <h1>Your lifelong, self-paced AI tutor.</h1>
        <p>
          Build personalized courses, move at your own pace, and keep a persistent tutor that
          learns how you learn.
        </p>
        <div className="buttonRow">
          <Link href="/courses/new" className="ctaLink">
            Create a course
          </Link>
          <Link href="/onboarding" className="ghostLink">
            Start onboarding
          </Link>
          <Link href="/state/local-learner" className="ghostLink">
            Open sample state editor
          </Link>
        </div>
      </section>

      <section>
        <h2>Initial MVP focus</h2>
        <ul>
          {features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
