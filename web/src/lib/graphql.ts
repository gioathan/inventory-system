import { ApiError, apiFetch } from "./api";

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
}

// GraphQL reports failures as HTTP 200 with an `errors` array, so a plain fetch wrapper would
// treat a denied or broken query as success. Translating them into the same ApiError the REST
// calls throw means one error path for the whole UI (including "don't retry a 403").
export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const body = await apiFetch<GraphQLResponse<T>>("dashboard", "graphql", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });

  if (body.errors?.length) {
    const [first] = body.errors;
    const status =
      first.extensions?.code === "AUTH_NOT_AUTHENTICATED" ? 401 : first.extensions?.code === "AUTH_NOT_AUTHORIZED" ? 403 : 500;
    throw new ApiError(status, first.message);
  }
  if (!body.data) throw new ApiError(500, "The server returned an empty response.");
  return body.data;
}
