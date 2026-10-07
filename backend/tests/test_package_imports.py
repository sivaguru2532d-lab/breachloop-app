import breachloop


def test_public_package_exports_include_attack_path_step():
    assert hasattr(breachloop, "AttackPathStep")
    assert hasattr(breachloop, "WorkflowVerification")
