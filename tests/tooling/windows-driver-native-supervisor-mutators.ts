// Native supervisor fixture mutations stay separate from orchestration so every test uses the same real PowerShell path.
export function mutateSupervisorScript(source: string, fixtureEnv?: Record<string, string>): string {
  let supervisorScript = source;
  if (fixtureEnv?.TEST_SUPERVISOR_HOLD_UNREAD_POLL) {
    const clock = '$bootEnd = [math]::Min($launch + $SchedulerBootMs, $Limit)';
    if (!supervisorScript.includes(clock)) throw new Error("scheduler boot clock changed shape");
    supervisorScript = supervisorScript.replace(clock, clock + `
  if ($Name -eq "scheduler-poll") {
    @{ bootEnd=$bootEnd; limit=$Limit; readyPath=$readyPath } | ConvertTo-Json -Compress |
      Set-Content -LiteralPath "$env:TEST_ROOT/poll-clock.json" -Encoding UTF8
  }`);
    const tick = 'while ($true) {\n      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()';
    if (!supervisorScript.includes(tick)) throw new Error("scheduler tick changed shape");
    supervisorScript = supervisorScript.replace(tick, `while ($true) {
      if ($Name -eq "scheduler-poll" -and -not $script:heldPollTick) {
        $script:heldPollTick = $true
        while (-not (Test-Path -LiteralPath "$env:TEST_ROOT/release-poll-tick")) { [Threading.Thread]::Sleep(10) }
      }
      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()`);
  }
  if (fixtureEnv?.TEST_SUPERVISOR_HOLD_POST_EXIT_POLL) {
    const anchor = '    }\n    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()\n    if ($null -eq $end) {';
    if (!supervisorScript.includes(anchor)) throw new Error("scheduler post-exit clock changed shape");
    supervisorScript = supervisorScript.replace(anchor, `    }
    if ($Name -eq "scheduler-poll") {
      @{ bootEnd=$bootEnd; limit=$Limit; readyPath=$readyPath } | ConvertTo-Json -Compress |
        Set-Content -LiteralPath "$env:TEST_ROOT/post-exit-clock.json" -Encoding UTF8
      [IO.File]::WriteAllText("$env:TEST_ROOT/post-exit-held", "held")
      while (-not (Test-Path -LiteralPath "$env:TEST_ROOT/release-post-exit")) { [Threading.Thread]::Sleep(10) }
    }
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($null -eq $end) {`);
  }
  if (process.env.TEST_REVERT_UNREAD_MARKER_ORDER === "1") {
    const old = 'Assert-SchedulerDeadline $Name $now $Limit $(if ($null -eq $end) { $bootEnd } else { $end })';
    const marker = 'if ($null -eq $end) {\n        $stamp = Read-SchedulerReadyStamp';
    if (!supervisorScript.includes(old) || !supervisorScript.includes(marker)) throw new Error("unread marker fix changed shape");
    supervisorScript = supervisorScript.replace(marker, old + '\n      ' + marker);
  }
  if (process.env.TEST_REVERT_BOOT_EFFECTIVE_END === "1") {
    const fixed = 'Assert-SchedulerDeadline $Name $now $Limit $(if ($null -eq $end) { $bootEnd } else { $end })';
    if (!supervisorScript.includes(fixed)) throw new Error("boot effective end changed shape");
    supervisorScript = supervisorScript.replace(fixed, 'Assert-SchedulerDeadline $Name $now $Limit $end');
  }
  if (process.env.TEST_REVERT_POST_EXIT_BLOCK === "1") {
    const breakAnchor = '      if ($child.HasExited) { break }';
    const breakAt = supervisorScript.indexOf(breakAnchor);
    const fixed = `    if ($null -eq $end) {
      $stamp = Read-SchedulerReadyStamp $readyPath $readyNonce $child.Id $launch $bootEnd $now
      if ($null -ne $stamp) { $end = [math]::Min($stamp + $PhaseMs, $Limit) }
    }
    Assert-SchedulerDeadline $Name $now $Limit $(if ($null -eq $end) { $bootEnd } else { $end })`;
    if (breakAt < 0) throw new Error("post-exit break changed shape");
    const before = supervisorScript.slice(0, breakAt + breakAnchor.length);
    const postExit = supervisorScript.slice(breakAt + breakAnchor.length);
    if (!postExit.includes(fixed)) throw new Error("post-exit deadline block changed shape");
    supervisorScript = before + postExit.replace(fixed, `    if ($null -eq $end) {
      $stamp = Read-SchedulerReadyStamp $readyPath $readyNonce $child.Id $launch $bootEnd $now
      if ($null -ne $stamp) { $end = [math]::Min($stamp + $PhaseMs, $Limit) }
      elseif ($now -ge $bootEnd) { throw "NATIVE_PHASE_TIMEOUT phase=$Name" }
    }
    Assert-SchedulerDeadline $Name $now $Limit $end`)
      .replace('    Assert-SchedulerDeadline $Name $now $Limit $(if ($null -eq $end) { $bootEnd } else { $end })\n    if ($child.ExitCode -ne 0',
        '    Assert-SchedulerDeadline $Name $now $Limit $end\n    if ($child.ExitCode -ne 0');
  }
  if (process.env.TEST_DISABLE_OUTER_WORKER_CHECK === "1") {
    const original = 'if ($workerEnd -le $effectiveLimit -and $now -ge $workerEnd)';
    if (!supervisorScript.includes(original)) throw new Error("outer worker check changed shape");
    supervisorScript = supervisorScript.replace(original, original.replace('if ($workerEnd', 'if ($false -and $workerEnd'));
  }
  for (const [name, guard] of [["NONCE", '$ready.nonce -ceq $ReadyNonce'], ["PID", '[long]$ready.pid -eq $ChildId'],
    ["STALE", '$stamp -ge $Launch']] as const) {
    if (process.env[`TEST_DISABLE_MARKER_${name}_CHECK`] === "1") {
      if (!supervisorScript.includes(guard)) throw new Error(`marker ${name} check changed shape`);
      supervisorScript = supervisorScript.replace(guard, "$true");
    }
  }
  if (process.env.TEST_DISABLE_DEADLINE_PRECEDENCE === "1") {
    const guard = '$workerEnd -le $schedulerEnd -and $Now -ge $workerEnd';
    if (!supervisorScript.includes(guard)) throw new Error("deadline precedence check changed shape");
    supervisorScript = supervisorScript.replace(guard, "$false -and " + guard);
  }
  if (process.env.TEST_DISABLE_POST_EXIT_WORKER_PRECEDENCE === "1") {
    const anchor = 'Assert-SchedulerDeadline $Name $now $Limit $(if ($null -eq $end) { $bootEnd } else { $end })\n    if ($child.ExitCode -ne 0';
    if (!supervisorScript.includes(anchor)) throw new Error("post-exit precedence check changed shape");
    supervisorScript = supervisorScript.replace(anchor,
      'if ($now -ge [math]::Min($Limit, $(if ($null -eq $end) { $bootEnd } else { $end }))) { throw "NATIVE_PHASE_TIMEOUT phase=$Name" }\n    if ($child.ExitCode -ne 0');
  }
  if (fixtureEnv?.TEST_SUPERVISOR_READY_EXIT_RACE) {
    const anchor = '$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()';
    if (!supervisorScript.includes(anchor)) throw new Error("scheduler tick changed shape");
    supervisorScript = supervisorScript.replace(anchor, anchor + `
      if ($Name -eq "scheduler-start" -and -not (Test-Path "$env:TEST_ROOT/supervisor-sampled")) {
        [IO.File]::WriteAllText("$env:TEST_ROOT/supervisor-sampled", "sampled")
        while (-not $child.HasExited) { [Threading.Thread]::Sleep(10) }
      }`);
  }
  if (fixtureEnv?.TEST_SUPERVISOR_WAIT_FOR_LATE_READY) {
    const anchor = 'while ($true) {\n      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()';
    if (!supervisorScript.includes(anchor)) throw new Error("scheduler wait changed shape");
    supervisorScript = supervisorScript.replace(anchor, `while ($true) {
      if ($Name -eq "scheduler-start" -and -not $script:lateReadyObserved) {
        $script:lateReadyObserved = $true
        while (-not $child.HasExited) { [Threading.Thread]::Sleep(10) }
      }
      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()`);
  }
  if (fixtureEnv?.TEST_SUPERVISOR_DELAY_POLL_TICK_PAST_LIMIT) {
    const anchor = 'while ($true) {\n      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()';
    if (!supervisorScript.includes(anchor)) throw new Error("scheduler wait changed shape");
    supervisorScript = supervisorScript.replace(anchor, `while ($true) {
      if ($Name -eq "scheduler-poll" -and $null -ne $end -and -not $script:pollTickDelayed) {
        $script:pollTickDelayed = $true
        while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $Limit + 150) { [Threading.Thread]::Sleep(10) }
      }
      $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()`);
  }
  if (fixtureEnv?.TEST_SUPERVISOR_DELAY_OUTER_PAST_WORK_END) {
    const anchor = '$lastPoll = $now';
    if (!supervisorScript.includes(anchor)) throw new Error("outer poll cadence changed shape");
    supervisorScript = supervisorScript.replace(anchor, anchor + `
        if (-not $script:outerTickDelayed) {
          $script:outerTickDelayed = $true
          while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $workEnd + 150) { [Threading.Thread]::Sleep(10) }
        }`);
  }
  if (fixtureEnv?.TEST_SUPERVISOR_RESUME_AFTER_FIRST_POLL_WORKER_END) {
    const anchor = '$lastPoll = $now';
    if (!supervisorScript.includes(anchor)) throw new Error("outer poll cadence changed shape");
    supervisorScript = supervisorScript.replace(anchor, anchor + `
        if (-not $script:firstPollWorkerWait) {
          $script:firstPollWorkerWait = $true
          while ($true) {
            $worker = Read-WorkerProgress
            if ($worker -and -not $worker.phaseComplete) { break }
            if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $workEnd) { throw "fixture worker progress missing" }
            [Threading.Thread]::Sleep(10)
          }
          while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt [long]$worker.phaseStartedMs + $PhaseMs + 100) {
            [Threading.Thread]::Sleep(10)
          }
        }`);
  }
  if (process.env.TEST_DISABLE_WORKER_PHASE_CHECKS === "1" || fixtureEnv?.TEST_DISABLE_WORKER_PHASE_CHECKS === "1") {
    const inWait = '$workerEnd -le $schedulerEnd -and $Now -ge $workerEnd';
    const outer = '$workerEnd -le $effectiveLimit -and $now -ge $workerEnd';
    if (!supervisorScript.includes(inWait) || !supervisorScript.includes(outer)) throw new Error("worker phase checks changed shape");
    supervisorScript = supervisorScript.replace(inWait, '$false -and ' + inWait).replace(outer, '$false -and ' + outer);
  }
  if (process.env.TEST_SKIP_POST_EXIT_LIMIT_CHECK === "1") {
    const check = 'Assert-SchedulerDeadline $Name $now $Limit $(if ($null -eq $end) { $bootEnd } else { $end })\n    ';
    const resultAnchor = 'if (-not (Test-Path -LiteralPath $resultPath))';
    const answerAnchor = 'if ($child.ExitCode -ne 0';
    if (!supervisorScript.includes(check + resultAnchor) || !supervisorScript.includes(check + answerAnchor)) {
      throw new Error("post-exit limit checks changed shape");
    }
    supervisorScript = supervisorScript.replace(check + resultAnchor, resultAnchor).replace(check + answerAnchor, answerAnchor);
  }
  if (fixtureEnv?.TEST_SUPERVISOR_RESULT_READ_DELAY_MS) {
    const anchor = 'if (-not (Test-Path -LiteralPath $resultPath))';
    if (!supervisorScript.includes(anchor)) throw new Error("scheduler result read changed shape");
    supervisorScript = supervisorScript.replace(anchor,
      'if ($Name -eq "scheduler-start") { [Threading.Thread]::Sleep([int]$env:TEST_SUPERVISOR_RESULT_READ_DELAY_MS) }\n    ' + anchor);
  }
  return supervisorScript;
}

export function mutateRunScript(source: string): string {
  let runScript = source;
  if (process.env.TEST_BYPASS_NATIVE_LATCH === "1") {
    const check = 'if (Test-Path -LiteralPath $blocked) { throw "NATIVE_RECONCILIATION_REQUIRED" }';
    if (!runScript.includes(check)) throw new Error("native latch guard changed shape");
    runScript = runScript.replaceAll(check, 'if ($false -and (Test-Path -LiteralPath $blocked)) { throw "NATIVE_RECONCILIATION_REQUIRED" }');
  }
  if (process.env.TEST_BYPASS_COMMITTED_RESULT === "1") {
    const check = 'elseif ($rc -eq 0 -and $workerResult.status -ne "completed")';
    if (!runScript.includes(check)) throw new Error("committed result guard changed shape");
    runScript = runScript.replace(check, 'elseif ($false -and $rc -eq 0 -and $workerResult.status -ne "completed")');
  }
  if (process.env.TEST_MISLABEL_COMMITTED_FAILURE_AS_MISSING === "1") {
    const check = 'if ($rc -eq 0 -and -not $workerResult)';
    if (!runScript.includes(check)) throw new Error("committed failure guard changed shape");
    runScript = runScript.replace(check, 'if ($rc -eq 0)');
  }
  return runScript;
}
