import { createFakeGl } from "../testing/fake-gl";

describe("createFakeGl", () => {
  it("reports a compiled shader as successful by default", () => {
    const gl = createFakeGl();
    const shader = gl.createShader(gl.FRAGMENT_SHADER);

    gl.shaderSource(shader, "void main() {}");
    gl.compileShader(shader);

    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBe(true);
  });

  it("fails compilation and returns the scripted log when told to", () => {
    const gl = createFakeGl({ failShaderCompile: true, shaderLog: "ERROR: 0:7: nope" });
    const shader = gl.createShader(gl.FRAGMENT_SHADER);

    gl.compileShader(shader);

    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBe(false);
    expect(gl.getShaderInfoLog(shader)).toBe("ERROR: 0:7: nope");
  });

  it("fails linking independently of compilation", () => {
    const gl = createFakeGl({ failProgramLink: true, programLog: "ERROR: link failed" });
    const program = gl.createProgram();

    gl.linkProgram(program);

    expect(gl.getProgramParameter(program, gl.LINK_STATUS)).toBe(false);
    expect(gl.getProgramInfoLog(program)).toBe("ERROR: link failed");
  });

  it("tracks created and deleted objects so leaks are observable", () => {
    const gl = createFakeGl();
    const shader = gl.createShader(gl.VERTEX_SHADER);
    const program = gl.createProgram();

    expect(gl.liveObjectCount()).toBe(2);

    gl.deleteShader(shader);
    gl.deleteProgram(program);

    expect(gl.liveObjectCount()).toBe(0);
    expect(gl.createdCount()).toBe(2);
    expect(gl.deletedCount()).toBe(2);
  });

  it("records uniform writes and draw calls", () => {
    const gl = createFakeGl();
    const program = gl.createProgram();
    const location = gl.getUniformLocation(program, "iTime");

    gl.uniform1f(location, 1.5);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    expect(gl.uniformCalls).toEqual([{ name: "iTime", values: [1.5] }]);
    expect(gl.drawCount()).toBe(1);
  });
});
