from typing import Annotated

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, Query, status

from smartsku_backend.api.schemas import (
    AssemblyPickSchema,
    AssemblyRequest,
    AssemblySchema,
    AvailabilitySchema,
    BoxClaimRequest,
    BoxPlacementRequest,
    BoxRenameRequest,
    BoxSchema,
    CalibrationProgressSchema,
    CalibrationRequest,
    CalibrationSchema,
    ClusterRenameRequest,
    ClusterSchema,
    ComponentSchema,
    InventoryEventSchema,
    ItemAvailabilitySchema,
    LockerSchema,
    OnboardingSettingsSchema,
    ScaleRequest,
    ScaleResultSchema,
    SpecificationItemSchema,
    SpecificationRequest,
    SpecificationSchema,
    StockCellSchema,
)
from smartsku_backend.config import OnboardingConfig
from smartsku_backend.db.models import CalibrationStatus
from smartsku_backend.services.assembly import AssemblyService, AssemblyView
from smartsku_backend.services.calibration import CalibrationService
from smartsku_backend.services.inventory import ComponentService, InventoryQueryService
from smartsku_backend.services.layout import LayoutService
from smartsku_backend.services.provisioning import ProvisioningService
from smartsku_backend.services.scale import ScaleService
from smartsku_backend.services.specifications import SpecificationLine, SpecificationService, SpecificationView


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


class LayoutController:
    """Stands and where each box stands on them, so people find a box by its address instead of its id."""

    def __init__(self) -> None:
        self.router = APIRouter(prefix="/api", tags=["layout"], route_class=DishkaRoute)
        self.router.add_api_route("/clusters", self.list_clusters, methods=["GET"], response_model=list[ClusterSchema])
        self.router.add_api_route(
            "/clusters/{cluster_id}", self.rename_cluster, methods=["PATCH"], response_model=ClusterSchema
        )
        self.router.add_api_route("/boxes/{box_id}", self.rename_box, methods=["PATCH"], response_model=BoxSchema)
        self.router.add_api_route(
            "/boxes/{box_id}/placement", self.place_box, methods=["PUT"], response_model=BoxSchema
        )
        self.router.add_api_route(
            "/boxes/{box_id}/placement", self.unplace_box, methods=["DELETE"], response_model=BoxSchema
        )

    async def list_clusters(self, layout: FromDishka[LayoutService]) -> list[ClusterSchema]:
        return [ClusterSchema.model_validate(cluster) for cluster in await layout.clusters()]

    async def rename_cluster(
        self, cluster_id: int, request: ClusterRenameRequest, layout: FromDishka[LayoutService]
    ) -> ClusterSchema:
        return ClusterSchema.model_validate(await layout.rename_cluster(cluster_id, request.name.strip()))

    async def rename_box(self, box_id: str, request: BoxRenameRequest, layout: FromDishka[LayoutService]) -> BoxSchema:
        alias = request.alias.strip() if request.alias else None
        return BoxSchema.model_validate(await layout.rename_box(box_id, alias))

    async def place_box(
        self, box_id: str, request: BoxPlacementRequest, layout: FromDishka[LayoutService]
    ) -> BoxSchema:
        """Puts the box into a grid cell next to another box of the stand; the stand is renumbered from A1."""
        return BoxSchema.model_validate(await layout.place(box_id, request.cluster_id, request.x, request.y))

    async def unplace_box(self, box_id: str, layout: FromDishka[LayoutService]) -> BoxSchema:
        return BoxSchema.model_validate(await layout.unplace(box_id))


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


class SpecificationsController:
    """Products and the components one piece of each takes."""

    def __init__(self) -> None:
        self.router = APIRouter(prefix="/api/specifications", tags=["assembly"], route_class=DishkaRoute)
        self.router.add_api_route(
            "", self.list_specifications, methods=["GET"], response_model=list[SpecificationSchema]
        )
        self.router.add_api_route(
            "", self.create, methods=["POST"], response_model=SpecificationSchema, status_code=status.HTTP_201_CREATED
        )
        self.router.add_api_route(
            "/{specification_id}", self.update, methods=["PUT"], response_model=SpecificationSchema
        )
        self.router.add_api_route(
            "/{specification_id}", self.delete, methods=["DELETE"], status_code=status.HTTP_204_NO_CONTENT
        )
        self.router.add_api_route(
            "/{specification_id}/availability",
            self.availability,
            methods=["GET"],
            response_model=AvailabilitySchema,
        )

    async def list_specifications(self, specifications: FromDishka[SpecificationService]) -> list[SpecificationSchema]:
        return [self._schema(view) for view in await specifications.all()]

    async def create(
        self, request: SpecificationRequest, specifications: FromDishka[SpecificationService]
    ) -> SpecificationSchema:
        return self._schema(await specifications.create(request.name, self._lines(request)))

    async def update(
        self, specification_id: int, request: SpecificationRequest, specifications: FromDishka[SpecificationService]
    ) -> SpecificationSchema:
        return self._schema(await specifications.update(specification_id, request.name, self._lines(request)))

    async def delete(self, specification_id: int, specifications: FromDishka[SpecificationService]) -> None:
        await specifications.delete(specification_id)

    async def availability(
        self,
        specification_id: int,
        assemblies: FromDishka[AssemblyService],
        kits: Annotated[int, Query(gt=0, le=1000)] = 1,
    ) -> AvailabilitySchema:
        """Whether the stands hold enough for this many products, and which cells an assembly would take from."""
        report = await assemblies.availability(specification_id, kits)
        return AvailabilitySchema(
            specification_id=report.specification_id,
            name=report.name,
            kits=report.kits,
            ok=report.ok,
            items=[
                ItemAvailabilitySchema(
                    component_name=item.component_name,
                    required=item.required,
                    available=item.available,
                    missing=item.missing,
                    elsewhere=item.elsewhere,
                    cells=[
                        StockCellSchema(
                            box_id=cell.state.box_id,
                            locker_id=cell.state.locker_id,
                            nfc_id=cell.component.nfc_id,
                            quantity=cell.quantity,
                        )
                        for cell in item.cells
                        if cell.state is not None
                    ],
                )
                for item in report.items
            ],
        )

    def _lines(self, request: SpecificationRequest) -> list[SpecificationLine]:
        return [SpecificationLine(item.component_name, item.quantity) for item in request.items]

    def _schema(self, view: SpecificationView) -> SpecificationSchema:
        specification = view.specification
        return SpecificationSchema(
            id=specification.id,
            name=specification.name,
            items=[SpecificationItemSchema.model_validate(item) for item in view.items],
            created_at=specification.created_at,
            updated_at=specification.updated_at,
        )


class AssembliesController:
    """Assembling by a specification: the displays of the stands guide the picking, the journal records it."""

    def __init__(self) -> None:
        self.router = APIRouter(prefix="/api/assemblies", tags=["assembly"], route_class=DishkaRoute)
        self.router.add_api_route("", self.list_assemblies, methods=["GET"], response_model=list[AssemblySchema])
        self.router.add_api_route(
            "", self.start, methods=["POST"], response_model=AssemblySchema, status_code=status.HTTP_201_CREATED
        )
        self.router.add_api_route("/{assembly_id}", self.cancel, methods=["DELETE"], response_model=AssemblySchema)

    async def list_assemblies(
        self, assemblies: FromDishka[AssemblyService], limit: Annotated[int, Query(ge=1, le=200)] = 20
    ) -> list[AssemblySchema]:
        """Newest first, with the progress of each cell."""
        return [self._schema(view) for view in await assemblies.recent(limit)]

    async def start(self, request: AssemblyRequest, assemblies: FromDishka[AssemblyService]) -> AssemblySchema:
        """409 with the missing components when the stock is short, or when another assembly runs."""
        return self._schema(await assemblies.start(request.specification_id, request.kits))

    async def cancel(self, assembly_id: int, assemblies: FromDishka[AssemblyService]) -> AssemblySchema:
        """Stops the assembly: the displays go back to counting."""
        return self._schema(await assemblies.cancel(assembly_id))

    def _schema(self, view: AssemblyView) -> AssemblySchema:
        assembly = view.assembly
        return AssemblySchema(
            id=assembly.id,
            specification_id=assembly.specification_id,
            name=assembly.name,
            kits=assembly.kits,
            status=assembly.status,
            started_at=assembly.started_at,
            finished_at=assembly.finished_at,
            picks=[
                AssemblyPickSchema(
                    component_name=item.pick.component_name,
                    nfc_id=item.pick.nfc_id,
                    box_id=item.pick.box_id,
                    locker_id=item.pick.locker_id,
                    quantity=item.pick.quantity,
                    start_quantity=item.pick.start_quantity,
                    current_quantity=item.quantity,
                    taken=item.taken,
                    remaining=item.remaining,
                    inserted=item.inserted,
                )
                for item in view.picks
            ],
        )
