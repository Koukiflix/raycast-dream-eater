import raycastConfig from "@raycast/eslint-config";
export default [...raycastConfig, { ignores: ["dist/**", "node_modules/**", "raycast-env.d.ts"] }];
