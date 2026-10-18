//go:build unix

package media

import (
	"os/exec"
	"syscall"
)

// killGroup starts the tool in its own process group and makes cancellation
// kill the group, children included.
func killGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}
