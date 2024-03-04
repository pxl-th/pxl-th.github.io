**Julia needs GPU-aware GC**

While some aspects make GPUs feel like first-class citizens in Julia,
others have left them struggle.

![Running out of GPU memory](/assets/gpu-memory.gif)

Above is a graph of VRAM usage while running [Nerf.jl](https://github.com/JuliaNeuralGraphics/Nerf.jl).

Currently Julia's GC (mark & sweep) does not know anything about GPU memory space,
so from the perspective of GC, GPU array is just a pointer to the memory plus some
additional data about its shape.

So even when running something as simple as the loop below you
are quickly hitting OOM, because arrays are not freed immediately
when they go out of scope.

```julia
for i in 1:100_000
    ROCArray{Int}(undef, 2^24) # 128 MiB
end
```

Current approach for handling this is to trigger GC manually every time when
the allocation fails or when the user has set some maximum threshold and try again.
This works OK-ish, until it doesn't...

![OOM](/assets/oom.gif)

At some point the memory pool decides to grow anyway (or if you forgot to set the limit)
and then the driver gives up.

And lastly, Julia uses task-local states so each task gets assigned its own
stream on which to execute kernels.
But GC runs in its own task, so all of the de-allocations have to use
global `NULL` stream unnecessarily forcing synchronization accross all streams
every time.

Having reference-counting for GC would significanlty help with this and not only for GPUs.
