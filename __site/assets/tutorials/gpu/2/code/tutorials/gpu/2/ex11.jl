# This file was generated, do not modify it. # hide
threads = 256
blocks = cld(length(y), threads)
@cuda threads=threads blocks=blocks vadd!(y, a, b)