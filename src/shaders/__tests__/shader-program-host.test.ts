import { ShaderProgramHost } from "../shader-program-host";
import { createFakeGl, type FakeGl } from "../testing/fake-gl";

const BODY = "fragColor = vec4(1.0);";

// The host only uses the subset of the GL surface the fake implements; the cast keeps the production
// signature honest without importing an expo-gl type Jest cannot construct.
const host = (gl: FakeGl) => new ShaderProgramHost(gl as never);

describe("ShaderProgramHost", () => {
  it("compiles a body and reports success", () => {
    const gl = createFakeGl();
    const result = host(gl).setBody(BODY);

    expect(result).toEqual({ ok: true });
  });

  it("returns mapped errors instead of throwing when compilation fails", () => {
    const gl = createFakeGl({
      failShaderCompile: true,
      shaderLog: "ERROR: 0:5: 'x' : undeclared identifier",
    });

    const result = host(gl).setBody(BODY);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors[0].line).toBe(1);
    expect(result.rawLog).toBe("ERROR: 0:5: 'x' : undeclared identifier");
    expect(result.showingLastWorking).toBe(false);
  });

  it("returns errors instead of throwing when linking fails", () => {
    const gl = createFakeGl({ failProgramLink: true, programLog: "ERROR: link failed" });

    const result = host(gl).setBody(BODY);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.rawLog).toBe("ERROR: link failed");
  });

  it("still has a program to render after a failed recompile", () => {
    let failing = false;
    const gl = createFakeGl();
    // Swap the compile verdict after the first successful compile.
    const original = gl.getShaderParameter;
    gl.getShaderParameter = ((...args: Parameters<typeof original>) =>
      failing ? false : original(...args)) as typeof original;
    gl.getShaderInfoLog = (() => "ERROR: 0:6: broken") as typeof gl.getShaderInfoLog;

    const subject = host(gl);
    expect(subject.setBody(BODY).ok).toBe(true);

    failing = true;
    const result = subject.setBody("broken");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.showingLastWorking).toBe(true);
    expect(subject.hasProgram()).toBe(true);
  });

  it("deletes the superseded program so repeated edits do not leak", () => {
    const gl = createFakeGl();
    const subject = host(gl);

    for (let index = 0; index < 5; index += 1) {
      subject.setBody(`float a = ${index}.0; fragColor = vec4(a);`);
    }

    // One program plus one position buffer survive; every superseded program and every shader is gone.
    expect(gl.liveObjectCount()).toBe(2);
  });

  it("deletes shaders after a successful link", () => {
    const gl = createFakeGl();
    host(gl).setBody(BODY);

    expect(gl.deletedCount()).toBe(2);
  });

  it("deletes the shader it created when compilation fails", () => {
    const gl = createFakeGl({ failShaderCompile: true });
    host(gl).setBody(BODY);

    expect(gl.liveObjectCount()).toBe(0);
  });

  it("skips recompilation when the body has not changed", () => {
    const gl = createFakeGl();
    const subject = host(gl);

    subject.setBody(BODY);
    const afterFirst = gl.createdCount();
    subject.setBody(BODY);

    expect(gl.createdCount()).toBe(afterFirst);
  });

  it("does not compile an empty body", () => {
    const gl = createFakeGl();
    const subject = host(gl);

    const result = subject.setBody("   \n  ");

    expect(result.ok).toBe(false);
    expect(subject.hasProgram()).toBe(false);
    expect(gl.createdCount()).toBe(0);
  });

  it("writes iResolution and iTime and draws when a program exists", () => {
    const gl = createFakeGl();
    const subject = host(gl);
    subject.setBody(BODY);

    subject.render(2.5, 400, 300);

    expect(gl.uniformCalls).toEqual([
      { name: "iResolution", values: [400, 300, 1] },
      { name: "iTime", values: [2.5] },
    ]);
    expect(gl.drawCount()).toBe(1);
  });

  it("does not draw when nothing has compiled", () => {
    const gl = createFakeGl();

    host(gl).render(0, 400, 300);

    expect(gl.drawCount()).toBe(0);
  });

  it("releases every object on dispose", () => {
    const gl = createFakeGl();
    const subject = host(gl);
    subject.setBody(BODY);

    subject.dispose();

    expect(gl.liveObjectCount()).toBe(0);
  });
});
