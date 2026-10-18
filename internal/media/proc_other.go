//go:build !unix

package media

import "os/exec"

// killGroup: without process groups, cancellation kills the tool itself
// (exec.CommandContext's default).
func killGroup(*exec.Cmd) {}
