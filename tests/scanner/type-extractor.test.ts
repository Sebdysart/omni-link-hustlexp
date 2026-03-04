import { describe, it, expect } from 'vitest';
import { extractTypes, extractSchemas } from '../../engine/scanner/type-extractor.js';

describe('type-extractor', () => {
  it('extracts TypeScript interfaces with fields', () => {
    const source = `
export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: Date;
}
`;
    const types = extractTypes(source, 'types.ts', 'typescript', 'backend');
    expect(types).toHaveLength(1);
    expect(types[0].name).toBe('User');
    expect(types[0].fields).toHaveLength(4);
    expect(types[0].fields[2].optional).toBe(true);
  });

  it('extracts Zod schemas', () => {
    const source = `
export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  age: z.number().optional(),
});
`;
    const schemas = extractSchemas(source, 'schemas.ts', 'typescript', 'backend');
    expect(schemas).toHaveLength(1);
    expect(schemas[0].name).toBe('createUserSchema');
    expect(schemas[0].kind).toBe('zod');
    expect(schemas[0].fields).toHaveLength(3);
  });

  it('extracts Swift Codable structs', () => {
    const source = `
struct UserDTO: Codable {
    let id: String
    let email: String
    var name: String?
}
`;
    const types = extractTypes(source, 'Models.swift', 'swift', 'ios-app');
    expect(types).toHaveLength(1);
    expect(types[0].name).toBe('UserDTO');
    expect(types[0].fields).toHaveLength(3);
    expect(types[0].fields[2].optional).toBe(true);
  });

  it('extracts Python dataclass/pydantic models', () => {
    const source = `
class User(BaseModel):
    id: str
    email: str
    name: Optional[str] = None
`;
    const types = extractTypes(source, 'models.py', 'python', 'backend');
    expect(types).toHaveLength(1);
    expect(types[0].name).toBe('User');
  });

  it('extracts Go structs', () => {
    const source = `
type User struct {
  ID string
  Name string
}
`;
    const types = extractTypes(source, 'user.go', 'go', 'backend');
    expect(types).toHaveLength(1);
    expect(types[0].name).toBe('User');
    expect(types[0].fields).toHaveLength(2);
  });

  it('extracts Go grouped field declarations', () => {
    const source = `
type User struct {
  ID, Email string
}
`;
    const types = extractTypes(source, 'user.go', 'go', 'backend');
    expect(types).toHaveLength(1);
    expect(types[0].fields.map((field) => field.name)).toEqual(['ID', 'Email']);
  });

  it('extracts Rust structs', () => {
    const source = `
pub struct User {
  pub id: String,
  pub email: String,
}
`;
    const types = extractTypes(source, 'user.rs', 'rust', 'backend');
    expect(types).toHaveLength(1);
    expect(types[0].name).toBe('User');
    expect(types[0].fields).toHaveLength(2);
  });

  it('extracts Rust tuple structs with positional fields', () => {
    const source = `pub struct Pair(pub String, pub Option<String>);`;
    const types = extractTypes(source, 'pair.rs', 'rust', 'backend');
    expect(types).toHaveLength(1);
    expect(types[0].fields).toHaveLength(2);
    expect(types[0].fields[0].name).toBe('0');
    expect(types[0].fields[1].optional).toBe(true);
  });

  it('extracts Java classes and record fields', () => {
    const classSource = `
public class User {
  private String id;
  private String email;
}
`;
    const classTypes = extractTypes(classSource, 'User.java', 'java', 'backend');
    expect(classTypes).toHaveLength(1);
    expect(classTypes[0].name).toBe('User');
    expect(classTypes[0].fields).toHaveLength(2);

    const recordSource = `public record UserRecord(String id, String email) { }`;
    const recordTypes = extractTypes(recordSource, 'UserRecord.java', 'java', 'backend');
    expect(recordTypes[0].fields).toHaveLength(2);
  });

  it('extracts Java multiple declarators from a single field declaration', () => {
    const source = `
public class User {
  private String id, email;
}
`;
    const types = extractTypes(source, 'User.java', 'java', 'backend');
    expect(types).toHaveLength(1);
    expect(types[0].fields.map((field) => field.name)).toEqual(['id', 'email']);
  });

  describe('inheritance tracking', () => {
    it('captures single extends on interface', () => {
      const source = `interface Dog extends Animal { breed: string; }`;
      const types = extractTypes(source, 'types.ts', 'typescript', 'backend');
      const dog = types.find(t => t.name === 'Dog');
      expect(dog).toBeDefined();
      expect(dog!.extends).toBeDefined();
      expect(dog!.extends).toContain('Animal');
    });

    it('captures multiple extends on interface', () => {
      const source = `interface C extends A, B { x: number; }`;
      const types = extractTypes(source, 'types.ts', 'typescript', 'backend');
      const c = types.find(t => t.name === 'C');
      expect(c).toBeDefined();
      expect(c!.extends).toBeDefined();
      expect(c!.extends).toContain('A');
      expect(c!.extends).toContain('B');
    });

    it('captures intersection type parents', () => {
      const source = `type Combined = TypeA & TypeB;`;
      const types = extractTypes(source, 'types.ts', 'typescript', 'backend');
      const combined = types.find(t => t.name === 'Combined');
      expect(combined).toBeDefined();
      expect(combined!.extends).toBeDefined();
      expect(combined!.extends).toContain('TypeA');
      expect(combined!.extends).toContain('TypeB');
    });

    it('plain interface has no extends', () => {
      const source = `interface Simple { x: number; }`;
      const types = extractTypes(source, 'types.ts', 'typescript', 'backend');
      const simple = types.find(t => t.name === 'Simple');
      expect(simple).toBeDefined();
      const extendsField = simple!.extends;
      expect(!extendsField || extendsField.length === 0).toBe(true);
    });
  });
});
