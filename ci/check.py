import argparse
import contextlib
import os
import signal
import subprocess
import sys
import time

import path
import psutil

import utils
import pyback.client

@contextlib.contextmanager
def run_in_background(*cmd):
    process = subprocess.Popen(cmd, start_new_session=True)
    caught_error = None
    try:
        yield
    except Exception as e:
        caught_error = e
    finally:
        os.killpg(process.pid, signal.SIGTERM)
    if caught_error:
        raise caught_error



def run_linters():
    for lang in ["js", "flow"]:
        utils.run_yarn("lint:%s" % lang)


def run_tests_in_node(env=None):
    with run_in_background("docker", "run", "--publish", "27017:27017", "--rm", "mongo"):
        # Note: we expect mongo to be booted by the time the babel build is finished ...
        run_env = os.environ.copy()
        run_env["PROJECT_CONFIG"] = env
        run_env["TANKER_WEB_MONGODB_RUNNING"] = "true"
        utils.run_yarn("coverage", env=run_env)


def find_procs_by_name(name):
    "Return a list of processes matching 'name'."
    ls = []
    for p in psutil.process_iter(attrs=["name", "exe", "cmdline"]):
        if name == p.info['name'] or \
                p.info['exe'] and os.path.basename(p.info['exe']) == name or \
                p.info['cmdline'] and p.info['cmdline'][0] == name:
            ls.append(p)
    return ls


def kill_windows_process_if_running(name):
    processes = find_procs_by_name(name)
    for p in processes:
        p.kill()
    psutil.wait_procs(processes)


def delete_edge_state():
    kill_windows_process_if_running("MicrosoftEdge.exe")
    kill_windows_process_if_running("dllhost.exe")

    localappdata = os.environ.get("LOCALAPPDATA")
    edge_path = path.Path(r"%s\Packages\Microsoft.MicrosoftEdge_8wekyb3d8bbwe" % localappdata)  # noqa
    edge_ac_path = edge_path.joinpath("AC")
    user_default_path = edge_ac_path.joinpath(r"MicrosoftEdge\User\Default")

    targets = edge_ac_path.glob("#!*")
    targets.append(edge_path.joinpath(r"AppData"))
    targets.append(user_default_path.joinpath(r"Recovery\Active"))
    targets.append(user_default_path.joinpath("DataStore"))

    for target in targets:
        try:
            target.rmtree_p()
        except Exception as e:
            print("While attempting to clear Edge's state, unable to delete path:", target, ", error:" , e)


def delete_ie_state():
    kill_windows_process_if_running("iexplore.exe")
    kill_windows_process_if_running("dllhost.exe")

    try:
        localappdata = os.environ.get('LOCALAPPDATA')
        ie_db_path = path.Path(r"%s\Microsoft\Internet Explorer\Indexed DB" % localappdata)
        ie_db_path.rmtree_p()
    except Exception as e:
        print("While attempting to clear IE's state, unable to delete path:", ie_db_path, ", error:" , e)

    """
    This magic value is the combination of the following bitflags:
    #define CLEAR_HISTORY         0x0001 // Clears history
    #define CLEAR_COOKIES         0x0002 // Clears cookies
    #define CLEAR_CACHE           0x0004 // Clears Temporary Internet Files folder
    #define CLEAR_CACHE_ALL       0x0008 // Clears offline favorites and download history
    #define CLEAR_FORM_DATA       0x0010 // Clears saved form data for form auto-fill-in
    #define CLEAR_PASSWORDS       0x0020 // Clears passwords saved for websites
    #define CLEAR_PHISHING_FILTER 0x0040 // Clears phishing filter data
    #define CLEAR_RECOVERY_DATA   0x0080 // Clears webpage recovery data
    #define CLEAR_SHOW_NO_GUI     0x0100 // Do not show a GUI when running the cache clearing

    Total: 511
    """
    utils.run("RunDll32.exe", "InetCpl.cpl,ClearMyTracksByProcess", "511")
    time.sleep(5)


def delete_safari_state():
    safari_user_path = path.Path(r"~/Library/Safari").expanduser()
    safari_user_path.rmtree_p()


def run_tests_in_browser(*, env, runner):
    run_env = os.environ.copy()
    run_env["PROJECT_CONFIG"] = env

    if runner == "linux":
        utils.run_yarn("karma", "--browsers", "Firefox,Chromium", env=run_env)
    elif runner == "macos":
        utils.run("killall", "Safari", check=False)
        delete_safari_state()
        safari_awaker = subprocess.Popen(["bash", "ci/keep-safari-awake.sh"])
        try:
            utils.run_yarn("karma", "--browsers", "Safari", env=run_env)
        finally:
            safari_awaker.kill()
    elif runner == "windows-edge":
        delete_edge_state()
        pyback.client.run_client("yarn karma --browsers Edge", os.getcwd(), run_env)
    elif runner == "windows-ie":
        delete_ie_state()
        pyback.client.run_client("yarn karma --browsers IE", os.getcwd(), run_env)


def check(*, env, runner):
    utils.install_deps()
    if runner == "linux":
        utils.run_yarn("build:all")
        run_linters()
        run_tests_in_node(env=env)
    run_tests_in_browser(runner=runner, env=env)


def main():
    utils.print_cmd()
    parser = argparse.ArgumentParser()
    parser.add_argument("--runner")
    parser.add_argument("--env", default="dev")
    args = parser.parse_args()
    runner = args.runner
    env = args.env
    check(env=env, runner=runner)


if __name__ == "__main__":
    main()
