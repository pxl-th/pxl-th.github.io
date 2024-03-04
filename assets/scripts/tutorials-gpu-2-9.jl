function vadd!(y, a, b)
    i = threadIdx().x + (blockIdx().x - 1) * blockDim().x
    if i ≤ length(a)
        y[i] = a[i] + b[i]
    end
    return
end
