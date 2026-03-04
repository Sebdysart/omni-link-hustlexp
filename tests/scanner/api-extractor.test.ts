import { describe, it, expect } from 'vitest';
import {
  extractRoutes,
  extractExports,
  extractProcedures,
  extractScriptApiCallSites,
  extractSwiftApiCallSites,
} from '../../engine/scanner/api-extractor.js';

describe('api-extractor', () => {
  describe('extractExports (TypeScript)', () => {
    it('extracts exported functions', () => {
      const source = `
export function createUser(input: CreateUserInput): User {
  return db.insert(input);
}
export const deleteUser = (id: string) => db.delete(id);
`;
      const exports = extractExports(source, 'test.ts', 'typescript');
      expect(exports).toHaveLength(2);
      expect(exports[0].name).toBe('createUser');
      expect(exports[0].kind).toBe('function');
      expect(exports[1].name).toBe('deleteUser');
    });

    it('extracts exported classes', () => {
      const source = `export class UserService { }`;
      const exports = extractExports(source, 'test.ts', 'typescript');
      expect(exports[0].kind).toBe('class');
      expect(exports[0].name).toBe('UserService');
    });

    it('extracts exported types and interfaces', () => {
      const source = `
export interface User { id: string; name: string; }
export type UserId = string;
`;
      const exports = extractExports(source, 'test.ts', 'typescript');
      expect(exports).toHaveLength(2);
      expect(exports.find(e => e.name === 'User')?.kind).toBe('interface');
      expect(exports.find(e => e.name === 'UserId')?.kind).toBe('type');
    });
  });

  describe('extractRoutes (TypeScript — Hono/Express)', () => {
    it('extracts Hono route definitions', () => {
      const source = `
app.get('/api/users', (c) => c.json(users));
app.post('/api/users', async (c) => { });
app.delete('/api/users/:id', handler);
`;
      const routes = extractRoutes(source, 'routes.ts', 'typescript');
      expect(routes).toHaveLength(3);
      expect(routes[0]).toMatchObject({ method: 'GET', path: '/api/users' });
      expect(routes[1]).toMatchObject({ method: 'POST', path: '/api/users' });
      expect(routes[2]).toMatchObject({ method: 'DELETE', path: '/api/users/:id' });
    });
  });

  describe('extractProcedures (TypeScript — tRPC)', () => {
    it('extracts tRPC procedure definitions', () => {
      const source = `
export const userRouter = router({
  getUser: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => { }),
  createUser: publicProcedure
    .input(createUserSchema)
    .mutation(async ({ input }) => { }),
});
`;
      const procs = extractProcedures(source, 'router.ts', 'typescript');
      expect(procs).toHaveLength(2);
      expect(procs[0]).toMatchObject({ name: 'getUser', kind: 'query' });
      expect(procs[1]).toMatchObject({ name: 'createUser', kind: 'mutation' });
    });
  });

  describe('extractExports (Swift)', () => {
    it('extracts Swift functions and structs', () => {
      const source = `
func fetchUser(id: String) async throws -> User {
    return try await api.get("/users/\\(id)")
}
struct UserDTO: Codable {
    let id: String
    let name: String
}
class UserService {
    func create() { }
}
`;
      const exports = extractExports(source, 'User.swift', 'swift');
      expect(exports.find(e => e.name === 'fetchUser')).toBeDefined();
      expect(exports.find(e => e.name === 'UserDTO')?.kind).toBe('class');
      expect(exports.find(e => e.name === 'UserService')?.kind).toBe('class');
    });
  });

  describe('extractExports (Python)', () => {
    it('extracts public Python functions, classes, and constants', () => {
      const source = `
DEBUG = True

def create_app():
    return None

class Flask:
    debug: bool

def _hidden():
    return None
`;
      const exports = extractExports(source, 'app.py', 'python');
      expect(exports.find((entry) => entry.name === 'DEBUG')?.kind).toBe('constant');
      expect(exports.find((entry) => entry.name === 'create_app')?.kind).toBe('function');
      expect(exports.find((entry) => entry.name === 'Flask')?.kind).toBe('class');
      expect(exports.find((entry) => entry.name === '_hidden')).toBeUndefined();
    });
  });

  describe('extractExports (Go/Rust/Java)', () => {
    it('extracts exported Go functions and structs', () => {
      const source = `
type User struct {
    ID string
}

func GetUser() User {
    return User{}
}`;
      const exports = extractExports(source, 'user.go', 'go');
      expect(exports.find((entry) => entry.name === 'User')).toBeDefined();
      expect(exports.find((entry) => entry.name === 'GetUser')?.kind).toBe('function');
    });

    it('extracts grouped Go declarations and ignores unexported names', () => {
      const source = `
type (
  User struct {
    ID, Email string
  }
  service interface {
    getUser(id string) User
  }
)

func (s *Store) LoadUser(id string) User { return User{} }
const Version = "1"
var DefaultName = "demo"
`;
      const exports = extractExports(source, 'service.go', 'go');
      expect(exports.find((entry) => entry.name === 'User')?.kind).toBe('class');
      expect(exports.find((entry) => entry.name === 'LoadUser')?.kind).toBe('function');
      expect(exports.find((entry) => entry.name === 'Version')?.kind).toBe('constant');
      expect(exports.find((entry) => entry.name === 'DefaultName')?.kind).toBe('constant');
      expect(exports.find((entry) => entry.name === 'service')).toBeUndefined();
    });

    it('extracts exported Rust items', () => {
      const source = `
pub struct User {
    pub id: String,
}

pub fn get_user() -> User {
    User { id: String::new() }
}`;
      const exports = extractExports(source, 'lib.rs', 'rust');
      expect(exports.find((entry) => entry.name === 'User')).toBeDefined();
      expect(exports.find((entry) => entry.name === 'get_user')?.kind).toBe('function');
    });

    it('extracts public Rust traits, aliases, and constants only', () => {
      const source = `
pub trait Store {
    fn load(&self) -> String;
}

pub type UserId = String;
pub const VERSION: &str = "1";
struct Hidden;
`;
      const exports = extractExports(source, 'lib.rs', 'rust');
      expect(exports.find((entry) => entry.name === 'Store')?.kind).toBe('interface');
      expect(exports.find((entry) => entry.name === 'UserId')?.kind).toBe('type');
      expect(exports.find((entry) => entry.name === 'VERSION')?.kind).toBe('constant');
      expect(exports.find((entry) => entry.name === 'Hidden')).toBeUndefined();
    });

    it('extracts public Java classes and methods', () => {
      const source = `
public class UserService {
    public User getUser() {
        return new User();
    }
}`;
      const exports = extractExports(source, 'UserService.java', 'java');
      expect(exports.find((entry) => entry.name === 'UserService')).toBeDefined();
      expect(exports.find((entry) => entry.name === 'getUser')?.kind).toBe('function');
    });

    it('extracts Java interface methods and public constants while ignoring private methods', () => {
      const source = `
public interface Store {
    String getName();
}

public class UserService {
    public static final String VERSION = "1";
    public String getUser() {
        return "ok";
    }
    private void helper() {}
}
`;
      const exports = extractExports(source, 'UserService.java', 'java');
      expect(exports.find((entry) => entry.name === 'Store')?.kind).toBe('interface');
      expect(exports.find((entry) => entry.name === 'getName')?.kind).toBe('function');
      expect(exports.find((entry) => entry.name === 'VERSION')?.kind).toBe('constant');
      expect(exports.find((entry) => entry.name === 'helper')).toBeUndefined();
    });
  });

  describe('GraphQL extraction', () => {
    it('extracts Query fields from GraphQL schema as routes', () => {
      const source = `
    type Query {
      users: [User]
      post(id: ID!): Post
    }
  `;
      const routes = extractRoutes(source, 'schema.graphql', 'graphql');
      expect(routes.find(r => r.handler === 'users')).toBeDefined();
      expect(routes.find(r => r.handler === 'post')).toBeDefined();
      expect(routes.find(r => r.handler === 'users')?.method).toBe('QUERY');
      expect(routes.find(r => r.handler === 'post')?.method).toBe('QUERY');
    });

    it('extracts Mutation fields from GraphQL schema as routes', () => {
      const source = `
    type Mutation {
      createUser(input: CreateUserInput!): User
      deletePost(id: ID!): Boolean
    }
  `;
      const routes = extractRoutes(source, 'schema.graphql', 'graphql');
      expect(routes.find(r => r.handler === 'createUser')).toBeDefined();
      expect(routes.find(r => r.handler === 'deletePost')).toBeDefined();
      expect(routes.find(r => r.handler === 'createUser')?.method).toBe('MUTATION');
      expect(routes.find(r => r.handler === 'deletePost')?.method).toBe('MUTATION');
    });

    it('extracts Subscription fields from GraphQL schema as routes', () => {
      const source = `
    type Subscription {
      messageAdded: Message
    }
  `;
      const routes = extractRoutes(source, 'schema.graphql', 'graphql');
      expect(routes.find(r => r.handler === 'messageAdded')).toBeDefined();
      expect(routes.find(r => r.handler === 'messageAdded')?.method).toBe('SUBSCRIPTION');
    });

    it('does not extract non-root type fields as routes', () => {
      const source = `
    type User {
      id: ID!
      name: String
    }
  `;
      const routes = extractRoutes(source, 'schema.graphql', 'graphql');
      expect(routes).toHaveLength(0);
    });

    it('extracts fields from single-line type block', () => {
      const source = `type Query { health: Boolean }`;
      const routes = extractRoutes(source, 'schema.graphql', 'graphql');
      expect(routes.some(r => r.handler === 'health' && r.method === 'QUERY')).toBe(true);
    });
  });
});

describe('extractSwiftApiCallSites', () => {
  it('extracts route paths from TypeScript client call sites', () => {
    const source = `
export async function fetchUsers() {
  const res = await fetch(\`\${baseUrl}/api/users\`);
  return res.json();
}`;
    const results = extractScriptApiCallSites(source, 'src/client.ts');
    expect(results.some((entry) => entry.signature === '/api/users')).toBe(true);
  });

  it('ignores non-API absolute URLs in TypeScript string literals', () => {
    const source = `
const moduleUrl = "https://deno.land/x/hono@v4.0.0/mod.ts";
const docsUrl = "https://example.com/docs/getting-started";
`;
    const results = extractScriptApiCallSites(source, 'src/client.ts');
    expect(results).toEqual([]);
  });

  it('ignores standalone API-like string literals that are not request calls', () => {
    const source = `
const path = "/api/users";
const nested = { url: "/api/admin" };
`;
    const results = extractScriptApiCallSites(source, 'src/client.ts');
    expect(results).toEqual([]);
  });

  it('ignores commented route examples in TypeScript files', () => {
    const source = `
/**
 * app.get('/api/page', () => {})
 */
// fetch('/api/users')
`;
    const results = extractScriptApiCallSites(source, 'src/client.ts');
    expect(results).toEqual([]);
  });

  it('extracts URL path strings from Swift source', () => {
    const source = `
class UserService {
    func fetchUsers() async throws -> [User] {
        return try await apiClient.get("/api/users")
    }
    func createUser(_ body: CreateUserBody) async throws -> User {
        return try await apiClient.post("/api/users", body: body)
    }
}`;
    const results = extractSwiftApiCallSites(source, 'Services/UserService.swift');
    expect(results.length).toBeGreaterThan(0);
    const urlEntry = results.find(r => r.signature.includes('/api/users'));
    expect(urlEntry).toBeDefined();
    expect(urlEntry!.file).toBe('Services/UserService.swift');
    expect(urlEntry!.kind).toBe('constant');
  });

  it('extracts tRPC procedure names from Swift source', () => {
    const source = `
class PostService {
    func createPost(body: CreatePostBody) async throws -> Post {
        return try await trpcClient.mutation("post.create", body: body)
    }
    func listPosts() async throws -> [Post] {
        return try await trpcClient.query("post.list")
    }
}`;
    const results = extractSwiftApiCallSites(source, 'Services/PostService.swift');
    const createEntry = results.find(r => r.signature === 'post.create');
    const listEntry = results.find(r => r.signature === 'post.list');
    expect(createEntry).toBeDefined();
    expect(listEntry).toBeDefined();
    expect(createEntry!.file).toBe('Services/PostService.swift');
  });

  it('returns empty array for Swift source with no API calls', () => {
    const source = `
struct User: Codable {
    let id: String
    let name: String
}`;
    const results = extractSwiftApiCallSites(source, 'Models/User.swift');
    expect(results).toEqual([]);
  });

  it('does not extract non-API string literals', () => {
    const source = `
let greeting = "Hello world"
let errorMessage = "Something went wrong"
let version = "1.0.0"`;
    const results = extractSwiftApiCallSites(source, 'test.swift');
    expect(results).toHaveLength(0);
  });

  it('deduplicates repeated URL references in the same file', () => {
    const source = `
class Service {
    func a() async throws { return try await client.get("/api/posts") }
    func b() async throws { return try await client.get("/api/posts") }
}`;
    const results = extractSwiftApiCallSites(source, 'Services/Service.swift');
    const posts = results.filter(r => r.signature === '/api/posts');
    // Should only appear once (deduped by value+file key)
    expect(posts).toHaveLength(1);
  });

  it('extracts interpolated Swift base URLs', () => {
    const source = `
class Service {
    func load() async throws {
        let url = URL(string: "\\(baseURL)/api/users")!
        _ = url
    }
}`;
    const results = extractSwiftApiCallSites(source, 'Services/Service.swift');
    expect(results.some((entry) => entry.signature === '/api/users')).toBe(true);
  });
});
