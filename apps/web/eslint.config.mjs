import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "public/sw.js", "playwright-report/**", "test-results/**"],
  },
  {
    rules: {
      // Never ship secrets to the client bundle.
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/^NEXT_PUBLIC_.*(SECRET|SERVICE_ROLE|PRIVATE|TOKEN|API_KEY)/]",
          message: "Secrets must never be exposed through NEXT_PUBLIC_ variables.",
        },
      ],
    },
  },
];

export default config;
