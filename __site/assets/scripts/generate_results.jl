dir = @__DIR__

"""
    genplain(s)

Small helper function to run some code and redirect the output (stdout) to a file.
"""
function genplain(s::String)
    script = joinpath(dir, s)
    fpath = joinpath(dir, "output", "$(splitext(s)[1]).out")
    fdir = dirname(fpath)

    isdir(fdir) || mkpath(fdir)

    open(fpath, "w") do outf
        redirect_stdout(outf) do
            include(script)
        end
    end
end

genplain("tutorials-gpu-2-1.jl")
genplain("tutorials-gpu-2-2.jl")
genplain("tutorials-gpu-2-3.jl")
genplain("tutorials-gpu-2-4.jl")
genplain("tutorials-gpu-2-5.jl")
genplain("tutorials-gpu-2-6.jl")
genplain("tutorials-gpu-2-7.jl")
genplain("tutorials-gpu-2-8.jl")
genplain("tutorials-gpu-2-9.jl")
genplain("tutorials-gpu-2-10.jl")
genplain("tutorials-gpu-2-11.jl")
genplain("tutorials-gpu-2-12.jl")

# plots

# include("script2.jl")
