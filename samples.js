/* Sample content. Loaded before app.js.
   The demo .docx is embedded rather than fetched, so it still works when this
   page is opened straight off disk (file:// blocks fetch on local files). */

var SAMPLE_JD = "Senior Frontend Engineer (Remote, US)\n\n" +
"About the role\nWe are looking for a Senior Frontend Engineer to own the customer-facing dashboard used by 40,000 teams. " +
"You will work closely with design and backend to ship quickly without breaking things.\n\n" +
"What you will do\n- Build and maintain features in React and TypeScript\n- Improve Core Web Vitals and page load performance\n" +
"- Write unit tests and integration tests with Jest\n- Review pull requests and mentor two mid-level engineers\n" +
"- Work with GraphQL APIs alongside the backend team\n\n" +
"Requirements\n- 5+ years of frontend engineering experience\n- Deep knowledge of React, TypeScript, and modern CSS\n" +
"- Experience with state management (Redux or Zustand)\n- Familiarity with CI/CD pipelines and automated testing\n" +
"- Experience with accessibility (WCAG 2.1 AA)\n- Comfortable with Git and code review workflows\n" +
"- Strong communication skills and stakeholder management\n\n" +
"Nice to have\n- Next.js or Remix\n- Experience with design systems\n- AWS or GCP exposure\n- Prior experience in a SaaS company\n" +
"- Knowledge of A/B testing and feature flags";

var SAMPLE_RESUME = "Jordan Ellis\njordan.ellis@email.com | (415) 555-0182 | San Francisco, CA\n\n" +
"Summary\nFrontend developer with 6 years building web applications. Enjoy working on performance and clean interfaces.\n\n" +
"Experience\nFrontend Developer, Northwind Labs (2021 - present)\n" +
"- Rebuilt the customer dashboard used by 20,000 daily users\n- Cut page load time by 45% through code splitting and lazy loading\n" +
"- Wrote automated tests for the checkout flow\n- Helped onboard three new engineers\n\n" +
"Web Developer, Brightline Studio (2018 - 2021)\n- Built marketing sites for agency clients\n" +
"- Worked with designers on responsive layouts\n- Maintained a component library\n\n" +
"Skills\nJavaScript, ES6, React, CSS, HTML, Git, responsive design, webpack\n\n" +
"Education\nB.S. Computer Science, State University, 2018";

/* A real .docx whose layout is deliberately broken: contact details stuck in a
   text box, a two-column section, a table doing page layout, and hand-typed
   bullets. It exists so the structural checks have something to catch without
   anyone needing to hand over their own file first. */
var DEMO_DOCX_B64 =
  "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";

var DEMO_DOCX_NAME = "demo-resume-broken-on-purpose.docx";
