// Fetches a user's contribution calendar (the green squares) through the GraphQL API.

const QUERY = `query($login: String!) {
  user(login: $login) {
    login
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount date weekday } }
      }
    }
  }
}`;

export async function fetchContributions(login, token) {
  if (!token) {
    throw new Error(
      'the contributions scene needs a GitHub token: set GITHUB_TOKEN (in Actions it is passed automatically; locally try GITHUB_TOKEN=$(gh auth token))',
    );
  }
  let res;
  try {
    res = await fetch(process.env.GITHUB_GRAPHQL_URL ?? 'https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'github-3d-canvas' },
      body: JSON.stringify({ query: QUERY, variables: { login } }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new Error(`could not reach the GitHub API: ${err.message}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}: ${body.message ?? res.statusText}`);
  if (body.errors?.length) throw new Error(`GitHub API: ${body.errors.map((e) => e.message).join('; ')}`);
  if (!body.data?.user) throw new Error(`GitHub user "${login}" not found`);

  const calendar = body.data.user.contributionsCollection.contributionCalendar;
  return {
    user: body.data.user.login,
    total: calendar.totalContributions,
    from: calendar.weeks[0]?.contributionDays[0]?.date ?? null,
    to: calendar.weeks.at(-1)?.contributionDays.at(-1)?.date ?? null,
    // weeks[w][weekday] = count; days outside the calendar (first/last partial week) are null.
    weeks: calendar.weeks.map((week) => {
      const days = Array(7).fill(null);
      for (const d of week.contributionDays) days[d.weekday] = d.contributionCount;
      return days;
    }),
  };
}

// GitHub's own colouring: 0 is level 0, the rest split into quartiles of the non-zero counts.
export function contributionLevels(weeks) {
  const counts = weeks.flat().filter((c) => c > 0).sort((a, b) => a - b);
  const quartile = (q) => counts[Math.min(counts.length - 1, Math.floor(q * counts.length))] ?? 0;
  const [q1, q2, q3] = [quartile(0.25), quartile(0.5), quartile(0.75)];
  return weeks.map((days) =>
    days.map((c) => (c === null ? null : c <= 0 ? 0 : c <= q1 ? 1 : c <= q2 ? 2 : c <= q3 ? 3 : 4)),
  );
}
