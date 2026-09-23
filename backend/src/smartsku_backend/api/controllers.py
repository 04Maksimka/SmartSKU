from typing import Annotated

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, Query, status

from smartsku_backend.api.schemas import (
    BoxClaimRequest,
    BoxSchema,
    CalibrationProgressSchema,
    CalibrationRequest,
    CalibrationSchema,
    ComponentSchema,
    InventoryEventSchema,
    LockerSchema,
    OnboardingSettingsSchema,
    ScaleRequest,
    ScaleResultSchema,
)
from smartsku_backend.config import OnboardingConfig
from smartsku_backend.db.models import CalibrationStatus
from smartsku_backend.services.calibration import CalibrationService
from smartsku_backend.services.inventory import ComponentService, InventoryQueryService
from smartsku_backend.services.provisioning import ProvisioningService
from smartsku_backend.services.scale import ScaleService


class BoxesController:
    def __init__(self) -> None:
        self.router = APIRouter(prefix="/api", tags=["boxes"], route_class=DishkaRoute)
        self.router.add_api_route("/boxes", self.list_boxes, methods=["GET"], response_model=list[BoxSchema])
        self.router.add_api_route("/lockers", self.list_lockers, methods=["GET"], response_model=list[LockerSchema])
        self.router.add_api_route(
            "/boxes/{box_id}/lockers/{locker_id}/scale",
            self.scale,
            methods=["POST"],
            response_model=ScaleResultSchema,
        )

    async def scale(
        self, box_id: str, locker_id: int, request: ScaleRequest, scale: FromDishka[ScaleService]
    ) -> ScaleResultSchema:
        """Load cell setup: zero the empty slot, scale it by the reference weight or weigh the empty cell.
        Waits for the box to measure (a few seconds); a failure comes as 409 with the reason."""
        result = await scale.run(box_id, locker_id, request.action, request.grams)
        return ScaleResultSchema(action=result.action, value=result.value, nfc_id=result.nfc_id)

    async def list_boxes(self, inventory: FromDishka[InventoryQueryService]) -> list[BoxSchema]:
        return [BoxSchema.model_validate(box) for box in await inventory.boxes()]

    async def list_lockers(
        self,
        inventory: FromDishka[InventoryQueryService],
        box_id: str | None = None,
        free: Annotated[bool | None, Query(description="true: lockers available for calibration")] = None,
    ) -> list[LockerSchema]:
        return [
            LockerSchema(
                box_id=state.box_id,
                locker_id=state.locker_id,
                nfc_flag=state.nfc_flag,
                nfc_id=state.nfc_id,
                weight=state.weight,
                quantity=state.quantity,
                slot_ready=state.slot_ready,
                cell_tared=state.cell_tared,
                tag_error=state.tag_error,
                calibration=CalibrationProgressSchema(
                    step=state.calibration_step, num_of_pieces=state.calibration_pieces
                )
                if state.calibration_step
                else None,
                updated_at=state.updated_at,
                component=ComponentSchema.model_validate(component) if component else None,
            )
            for state, component in await inventory.lockers(box_id, free)
        ]


class CalibrationController:
    def __init__(self) -> None:
        self.router = APIRouter(prefix="/api/calibrations", tags=["calibration"], route_class=DishkaRoute)
        self.router.add_api_route(
            "",
            self.start,
            methods=["POST"],
            response_model=CalibrationSchema,
            status_code=status.HTTP_201_CREATED,
        )
        self.router.add_api_route("", self.list, methods=["GET"], response_model=list[CalibrationSchema])
        self.router.add_api_route(
            "/{calibration_id}", self.cancel, methods=["DELETE"], response_model=CalibrationSchema
        )

    async def start(
        self, request: CalibrationRequest, calibrations: FromDishka[CalibrationService]
    ) -> CalibrationSchema:
        calibration = await calibrations.start(
            box_id=request.box_id,
            locker_id=request.locker_id,
            name=request.name,
            tags=request.tags,
            num_of_pieces=request.num_of_pieces,
        )
        return CalibrationSchema.model_validate(calibration)

    async def cancel(self, calibration_id: int, calibrations: FromDishka[CalibrationService]) -> CalibrationSchema:
        return CalibrationSchema.model_validate(await calibrations.cancel(calibration_id))

    async def list(
        self,
        calibrations: FromDishka[CalibrationService],
        status_filter: Annotated[CalibrationStatus | None, Query(alias="status")] = None,
    ) -> list[CalibrationSchema]:
        return [CalibrationSchema.model_validate(item) for item in await calibrations.list(status_filter)]


class ComponentsController:
    def __init__(self) -> None:
        self.router = APIRouter(prefix="/api", tags=["components"], route_class=DishkaRoute)
        self.router.add_api_route(
            "/components", self.list_components, methods=["GET"], response_model=list[ComponentSchema]
        )
        self.router.add_api_route(
            "/components/{nfc_id}",
            self.release_component,
            methods=["DELETE"],
            status_code=status.HTTP_204_NO_CONTENT,
        )
        self.router.add_api_route(
            "/events", self.list_events, methods=["GET"], response_model=list[InventoryEventSchema]
        )

    async def list_components(
        self,
        inventory: FromDishka[InventoryQueryService],
        search: str | None = None,
        tag: str | None = None,
    ) -> list[ComponentSchema]:
        return [ComponentSchema.model_validate(item) for item in await inventory.components(search, tag)]

    async def release_component(self, nfc_id: str, components: FromDishka[ComponentService]) -> None:
        await components.release(nfc_id)

    async def list_events(
        self,
        inventory: FromDishka[InventoryQueryService],
        box_id: str | None = None,
        nfc_id: str | None = None,
        limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    ) -> list[InventoryEventSchema]:
        return [InventoryEventSchema.model_validate(item) for item in await inventory.events(box_id, nfc_id, limit)]


class OnboardingController:
    """Connecting a new box from the dashboard: the browser talks to the box over Bluetooth, the backend only
    needs to expect it and to tell which broker address the box should use."""

    def __init__(self) -> None:
        self.router = APIRouter(prefix="/api/onboarding", tags=["onboarding"], route_class=DishkaRoute)
        self.router.add_api_route("/claims", self.claim, methods=["POST"], status_code=status.HTTP_204_NO_CONTENT)
        self.router.add_api_route("/settings", self.settings, methods=["GET"], response_model=OnboardingSettingsSchema)

    async def claim(self, request: BoxClaimRequest, provisioning: FromDishka[ProvisioningService]) -> None:
        await provisioning.claim(request.hardware_id.strip())

    async def settings(self, config: FromDishka[OnboardingConfig]) -> OnboardingSettingsSchema:
        return OnboardingSettingsSchema(
            broker_host=config.broker_host,
            broker_port=config.broker_port,
            broker_tls=config.broker_tls,
            broker_username=config.box_username,
            broker_password=config.box_password,
        )
