**In favor of Julia**

Discussions around Julia often end up concentrating on its
immediate disadvantages disregarding its current and future potential.

One area I think it fits particularly well at this moment is
in Neural Radiance Fields, because such algorithms are small enough to
be easily implemented from scratch in Julia.

No other language allows you (this easily) to write GPU kernels,
integrate them with AD ecosystem and run on different backends
without changing the source code of those kernels.

Take for example Multiresolution Hashgrid Encoding from
[Instant NGP](https://nvlabs.github.io/instant-ngp/) and compare its
[C++ implementation](https://github.com/NVlabs/tiny-cuda-nn/blob/master/include/tiny-cuda-nn/encodings/grid.h)
with
[Julia implementation](https://github.com/JuliaNeuralGraphics/NerfUtils.jl/blob/main/src/encoding/grid_kernels.jl).\\
And then add on top of it the complexity of integrating C++ implementation with popular
deep learning frameworks like PyTorch.

To tie forward and backward kernels with AD support in Julia
all you have to do is define a
[chain-rule](https://github.com/JuliaDiff/ChainRules.jl),
where `ge(x, θ)` computes a forward pass and `∇(ge, Δ2, x, θ)` backward for
given parameters `θ`.

```julia
function ChainRulesCore.rrule(ge::GridEncoding, x, θ)
    function encode_pullback(Δ)
        Δ2 = reshape(unthunk(Δ), (output_size(ge)..., size(x, 2)))
        Tangent{GridEncoding}(), NoTangent(), ∇(ge, Δ2, x, θ)
    end
    ge(x, θ), encode_pullback
end
```

Or see how GaussianSplatting algorithm that has 3 levels
([1](https://github.com/graphdeco-inria/diff-gaussian-rasterization/blob/59f5f77e3ddbac3ed9db93ec2cfe99ed6c5d121d/cuda_rasterizer/rasterizer_impl.cu),
[2](https://github.com/graphdeco-inria/diff-gaussian-rasterization/blob/59f5f77e3ddbac3ed9db93ec2cfe99ed6c5d121d/rasterize_points.cu),
[3](https://github.com/graphdeco-inria/diff-gaussian-rasterization/blob/59f5f77e3ddbac3ed9db93ec2cfe99ed6c5d121d/diff_gaussian_rasterization/__init__.py))
of very similar-looking wrappers just to go from C++/CUDA to Python/PyTorch.\\

And then the question of supporting multiple backends comes up (take Nvidia and AMD GPUs as an example),
where you have to install separate versions of PyTorch specifically compiled
for the particular CUDA/ROCm version.\\
And there ROCm version doesn't even get it's own device name, having to emulate `cuda`...

Whereas in Julia you just add respective backend package and import it in your
environment, where they extend packages with support for GPU.
E.g. with [Flux](https://github.com/FluxML/Flux.jl)
(an alternative to PyTorch in Julia) to enable respective GPU backend
you just import that package:
```julia
julia> using AMDGPU # Enables AMD GPU support
julia> using CUDA   # Enables Nvidia GPU support
julia> using Flux
```

No wonder
[nobody writes CUDA](https://twitter.com/jimkxa/status/1758943527743234234)
these days...

It's not that it is not beautiful, it's that it is cumbersome to make those
kernels useful afterwards.
