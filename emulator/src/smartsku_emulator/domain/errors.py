class EmulatorError(Exception):
    pass


class NotFoundError(EmulatorError):
    pass


class ConflictError(EmulatorError):
    pass
