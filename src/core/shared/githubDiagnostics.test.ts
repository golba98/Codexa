import assert from "node:assert/strict";
import test from "node:test";
import { 
  parseRepoIdentity, 
  classifyDiagnostics, 
  type DiagnosticResult, 
  type RepoIdentity 
} from "./githubDiagnostics.js";

test("parseRepoIdentity: handles various GitHub URL formats", () => {
  const cases = [
    {
      url: "https://github.com/owner/repo.git",
      expected: { owner: "owner", repo: "repo", provider: "github" }
    },
    {
      url: "git@github.com:owner/repo.git",
      expected: { owner: "owner", repo: "repo", provider: "github" }
    },
    {
      url: "https://github.com/owner/repo",
      expected: { owner: "owner", repo: "repo", provider: "github" }
    },
    {
      url: "ssh://git@github.com/owner/repo.git",
      expected: { owner: "owner", repo: "repo", provider: "github" }
    }
  ];

  for (const { url, expected } of cases) {
    const result = parseRepoIdentity(url);
    assert.ok(result);
    assert.equal(result.owner, expected.owner);
    assert.equal(result.repo, expected.repo);
    assert.equal(result.provider, expected.provider);
  }
});

test("parseRepoIdentity: handles missing or non-GitHub origins", () => {
  assert.equal(parseRepoIdentity(null), null);
  assert.equal(parseRepoIdentity(""), null);
  
  const other = parseRepoIdentity("https://gitlab.com/owner/repo.git");
  assert.ok(other);
  assert.equal(other.provider, "other");
});

test("classifyDiagnostics: handles all status combinations", () => {
  const repo: RepoIdentity = { owner: "o", repo: "r", provider: "github", remoteUrl: "..." };
  
  const pass: DiagnosticResult = { path: "p", status: "PASS", evidence: "e", blocker: null, recommendedUse: false };
  const fail: DiagnosticResult = { path: "p", status: "FAIL", evidence: "e", blocker: "b", recommendedUse: false };
  const partial: DiagnosticResult = { path: "p", status: "PARTIAL", evidence: "e", blocker: "b", recommendedUse: false };

  // 1. All PASS -> Local Git + GH CLI
  assert.equal(
    classifyDiagnostics(repo, pass, pass, pass, fail),
    "Local Git + GH CLI"
  );

  // 2. GH CLI missing but connector OK -> Connector-only
  assert.equal(
    classifyDiagnostics(repo, fail, pass, pass, pass),
    "Local Git + connector PR creation"
  );

  // 3. .git write fails but connector OK -> Connector-only
  assert.equal(
    classifyDiagnostics(repo, pass, pass, fail, pass),
    "Connector-only"
  );

  // 4. Connector read OK but write unknown (treated as PASS if not auth error)
  assert.equal(
    classifyDiagnostics(repo, fail, fail, fail, pass),
    "Connector-only"
  );

  // 5. Connector permission rejected
  const connectorRejected: DiagnosticResult = { path: "p", status: "PARTIAL", evidence: "e", blocker: "auth error", recommendedUse: false };
  assert.equal(
    classifyDiagnostics(repo, fail, fail, fail, connectorRejected),
    "Cannot publish yet"
  );

  // 6. Non-GitHub repo
  const otherRepo: RepoIdentity = { owner: "", repo: "", provider: "other", remoteUrl: "..." };
  assert.equal(
    classifyDiagnostics(otherRepo, pass, pass, pass, pass),
    "Cannot publish yet"
  );
});
