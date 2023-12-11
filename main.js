const vertShaderCode = `struct VSOut {
  @builtin(position) Position: vec4f,
  @location(0) color: vec3f,
};

@vertex
fn main(@location(0) inPos: vec3f,
      @location(1) inColor: vec3f) -> VSOut {
  var vsOut: VSOut;
  vsOut.Position = vec4f(inPos, 1);
  vsOut.color = inColor;
  return vsOut;
}`
const fragShaderCode = `@fragment
fn main(@location(0) inColor: vec3f) -> @location(0) vec4f {
    return vec4f(inColor, 1);
}`

// Get the canvas, resize it to fit the screen, init a context for use later
const canvas = document.querySelector('.webgpu')
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
canvas.style.width = canvas.width;
canvas.style.height = canvas.height;

class Renderer {
  constructor(adapter, device) {
    // Get WebGPU constants
    this.ADAPTER = adapter;
    this.DEVICE = device;
    this.QUEUE = this.DEVICE.queue;

    // Use the device to configure the canvas context
    this.CONTEXT = canvas.getContext('webgpu')
    this.CONTEXT.configure({
      device: this.DEVICE,
      format: 'bgra8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      alphaMode: 'opaque'
    })

    this.POSITIONS = new Float32Array([
      0.5, -0.5, 0.0, -0.5, -0.5, 0.0, 0.0, 0.5, 0.0
    ])
    this.COLORS = new Float32Array([
      1.0, 0.0, 0.0, // Red
      0.0, 1.0, 0.0, // Green
      0.0, 0.0, 1.0  // Blue
    ])
    this.INDICES = new Uint16Array([0, 1, 2])
    
    // Create Frame Buffer Attachments for texture views
    this.DEPTH_TEXTURE = device.createTexture({
      size: [canvas.width, canvas.height, 1],
      dimension: '2d',
      format: 'depth24plus-stencil8',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    })
    this.DEPTH_TEXTURE_VIEW = this.DEPTH_TEXTURE.createView();
    this.COLOR_TEXTURE = this.CONTEXT.getCurrentTexture();
    this.COLOR_TEXTURE_VIEW = this.COLOR_TEXTURE.createView();

    // Create buffers using helper function
    this.POSITION_BUFFER = this.createBuffer(this.POSITIONS, GPUBufferUsage.VERTEX)
    this.COLOR_BUFFER = this.createBuffer(this.COLORS, GPUBufferUsage.VERTEX)
    this.INDEX_BUFFER = this.createBuffer(this.INDICES, GPUBufferUsage.INDEX)

    // Create shader modules
    this.VERT_MODULE = device.createShaderModule({
      label: 'vert-shader',
      code: vertShaderCode
    })
    this.FRAG_MODULE = device.createShaderModule({
      label: 'frag-shader',
      code: fragShaderCode
    })

    // Graphics Pipeline
    // Input Assembly
    const positionBufferDesc = {
      attributes: [{
        shaderLocation: 0,
        offset: 0,
        format: 'float32x3'
      }],
      arrayStride: 4 * 3, // sizeof(float) * 3
      stepMode: 'vertex'
    }
    const colorBufferDesc = {
      attributes: [{
        shaderLocation: 1,
        offset: 0,
        format: 'float32x3'
      }],
      arrayStride: 4 * 3,
      stepMode: 'vertex'
    }

    
    /**
     * Pipeline Data
     * layout > vertex > fragment > primitive > depth
     */
    const layout = this.DEVICE.createPipelineLayout({ bindGroupLayouts: [] });

    const vertex = {
      module: this.VERT_MODULE,
      entryPoint: 'main',
      buffers: [positionBufferDesc, colorBufferDesc]
    }

    const fragment = {
      module: this.FRAG_MODULE,
      entryPoint: 'main',
      targets: [{
        format: 'bgra8unorm'
      }]
    }

    const primitive = {
      frontFace: 'cw',
      cullMode: 'none',
      topology: 'triangle-list'
    }

    const depthStencil = {
      depthWriteEnabled: true,
      depthCompare: 'less',
      format: 'depth24plus-stencil8'
    }

    this.PIPELINE = this.DEVICE.createRenderPipeline({
      layout,
      vertex,
      fragment,
      primitive,
      depthStencil
    });

    this.render()
  }

  render() {
    this.COLOR_TEXTURE = this.CONTEXT.getCurrentTexture();
    this.COLOR_TEXTURE_VIEW = this.COLOR_TEXTURE.createView();

    // Update color values
    this.COLORS.forEach((v, i) => {
      this.COLORS[i] += (Math.random() - 0.5) * 0.5
    })
    // Recreate the color buffer
    this.COLOR_BUFFER = this.createBuffer(this.COLORS, GPUBufferUsage.VERTEX)

    this.encodeCommands()
  }

  encodeCommands() {
    const renderPassDesc = {
      colorAttachments: [{
        view: this.COLOR_TEXTURE_VIEW,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }],
      depthStencilAttachment: {
        view: this.DEPTH_TEXTURE_VIEW,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        stencilClearValue: 0,
        stencilLoadOp: 'clear',
        stencilStoreOp: 'store'
      }
    }

    const commandEncoder = this.DEVICE.createCommandEncoder();

    const passEncoder = commandEncoder.beginRenderPass(renderPassDesc)
    passEncoder.setPipeline(this.PIPELINE)
    passEncoder.setViewport(0, 0, canvas.width, canvas.height, 0, 1)
    passEncoder.setScissorRect(0, 0, canvas.width, canvas.height)
    passEncoder.setVertexBuffer(0, this.POSITION_BUFFER)
    passEncoder.setVertexBuffer(1, this.COLOR_BUFFER)
    passEncoder.setIndexBuffer(this.INDEX_BUFFER, 'uint16')
    passEncoder.drawIndexed(3)
    passEncoder.end()

    this.QUEUE.submit([commandEncoder.finish()])
  }

  createBuffer(arr, usage) {
    // Align to 4 bytes (@chrimsonite)
    let desc = {
      size: (arr.byteLength + 3) & ~3,
      usage,
      mappedAtCreation: true
    }
    let buffer = this.DEVICE.createBuffer(desc);

    const writeArray = arr instanceof Uint16Array 
      ? new Uint16Array(buffer.getMappedRange())
      : new Float32Array(buffer.getMappedRange())
    
    writeArray.set(arr)
    buffer.unmap()

    return buffer
  }

  // Use a static init to load the adapter and device using async
  static async init() {
    const entry = navigator.gpu;

    if(!entry) {
      console.error('WebGPU is not supported on this device')
      return false;

    } else {
      console.log('WebGPU is installed!')
    
      const adapter = await entry.requestAdapter();
      const device = await adapter.requestDevice();

      return new Renderer(adapter, device)
    }
  }
}

// Create a renderer instance
const renderer = await Renderer.init();

function animate() {
  requestAnimationFrame(animate)

  if(renderer) {
    renderer.render()
  }
}

animate();